#!/usr/bin/env bash
# bridge.sh — install, relink, or remove the OpenClaw bridge runtime
#
# Subcommands (run as the runtime user, no sudo needed):
#   bridge.sh install              Install bridge-logger launcher to ~/.openclaw/
#   bridge.sh service              Install and start openclaw-bridge-logger systemd user service
#   bridge.sh uninstall            Stop service and back up bridge files
#
# Dispatcher (requires sudo):
#   sudo bridge.sh --email EMAIL [options]   Full setup/relink: runs bot:setup, writes IDs, installs bridge
#   sudo bridge.sh                           Install bridge without relinking workspace
#
# Options (relink/dispatcher):
#   --email <email>                Dashboard login email (required for relink)
#   --workspace-id <uuid>          Fixed workspace ID (relink, optional)
#   --agent-id <uuid>              Fixed agent ID (relink, optional)
#   --db-url <postgresql://...>    DB URL override (relink, optional)
#   --template-env </path>         Env file path (default: /etc/clawd/template.env)
#   --app-dir </path>              App dir override
#   --runtime-user <linux-user>    Runtime user override
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Defaults ---
SUBCOMMAND=""
ENV_FILE="${DASHBOARD_TEMPLATE_ENV:-/etc/clawd/template.env}"
APP_DIR="/home/clawdbot/apps/dashboard"
RUNTIME_USER="clawdbot"
APP_DIR_OVERRIDE=""
RUNTIME_USER_OVERRIDE=""
EMAIL=""
WORKSPACE_ID=""
AGENT_ID=""
DB_URL=""

# --- Parse first arg as subcommand if applicable ---
if [[ $# -gt 0 ]]; then
  case "$1" in
    install|service|uninstall) SUBCOMMAND="$1"; shift ;;
  esac
fi

# --- Parse remaining args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)        EMAIL="${2:-}";         shift 2 ;;
    --workspace-id) WORKSPACE_ID="${2:-}";  shift 2 ;;
    --agent-id)     AGENT_ID="${2:-}";      shift 2 ;;
    --db-url)       DB_URL="${2:-}";        shift 2 ;;
    --template-env) ENV_FILE="${2:-}";      shift 2 ;;
    --app-dir)
      APP_DIR="${2:-}"; APP_DIR_OVERRIDE="$APP_DIR"; shift 2 ;;
    --runtime-user)
      RUNTIME_USER="${2:-}"; RUNTIME_USER_OVERRIDE="$RUNTIME_USER"; shift 2 ;;
    --help|-h)      do_usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Subcommand: install
# Install bridge-logger launcher to ~/.openclaw/
# Run as the runtime user (no root needed)
# ---------------------------------------------------------------------------
do_install() {
  local target_dir="${HOME}/.openclaw"
  local template_env="${DASHBOARD_TEMPLATE_ENV:-/etc/clawd/template.env}"
  local source_logger="${REPO_ROOT}/scripts/bridge-logger.js"
  local target_logger="${target_dir}/bridge-logger.js"

  if [[ ! -f "$source_logger" ]]; then
    echo "Missing source logger template: $source_logger" >&2
    exit 1
  fi

  mkdir -p "$target_dir"
  local escaped_source
  escaped_source="$(printf '%s' "$source_logger" | sed 's/[\\"]/\\&/g')"
  cat > "$target_logger" <<EOF
#!/usr/bin/env node
"use strict";
require("${escaped_source}");
EOF
  chmod 700 "$target_logger"

  echo "Installed logger launcher to $target_logger"
  node -c "$target_logger"
  echo "Syntax check passed: $target_logger"

  if [[ -r "$template_env" ]]; then
    node "$REPO_ROOT/scripts/openclaw-bridge-validate.mjs" --env "$template_env" --logger "$target_logger"
  else
    echo "Skipped validator: no readable env file found at $template_env"
  fi
}

# ---------------------------------------------------------------------------
# Subcommand: service
# Install and start openclaw-bridge-logger as a systemd user service
# Run as the runtime user (no root needed)
# ---------------------------------------------------------------------------
do_service() {
  local source_unit="${REPO_ROOT}/scripts/systemd/openclaw-bridge-logger.service"
  local unit_dir="${HOME}/.config/systemd/user"
  local target_unit="${unit_dir}/openclaw-bridge-logger.service"
  local template_env="${DASHBOARD_TEMPLATE_ENV:-/etc/clawd/template.env}"
  local logger_file="${HOME}/.openclaw/bridge-logger.js"

  if [[ ! -f "$source_unit" ]]; then
    echo "Missing source unit file: $source_unit" >&2
    exit 1
  fi
  if [[ ! -f "$logger_file" ]]; then
    echo "Missing logger file: $logger_file" >&2
    echo "Run 'bridge.sh install' first." >&2
    exit 1
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found. Bridge runtime requires systemd user service." >&2
    exit 1
  fi
  if [[ ! -r "$template_env" ]]; then
    echo "Missing readable env file: $template_env" >&2
    exit 1
  fi

  mkdir -p "$unit_dir"
  install -m 644 "$source_unit" "$target_unit"

  node "$REPO_ROOT/scripts/openclaw-bridge-validate.mjs" --env "$template_env" --logger "$logger_file"

  if ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "No user systemd bus for $(whoami)." >&2
    echo "Run as root once: loginctl enable-linger $(whoami)" >&2
    exit 1
  fi

  systemctl --user daemon-reload
  systemctl --user enable --now openclaw-bridge-logger.service
  systemctl --user status openclaw-bridge-logger.service --no-pager
}

# ---------------------------------------------------------------------------
# Subcommand: uninstall
# Stop bridge service and back up bridge files
# Run as the runtime user (no root needed)
# ---------------------------------------------------------------------------
do_uninstall() {
  local service_name="openclaw-bridge-logger.service"
  local unit_dir="${HOME}/.config/systemd/user"
  local unit_path="${unit_dir}/${service_name}"
  local openclaw_dir="${HOME}/.openclaw"
  local backup_dir="${openclaw_dir}/backup-bridge-$(date +%Y%m%d-%H%M%S)"

  mkdir -p "$backup_dir"

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user stop "$service_name" || true
    systemctl --user disable "$service_name" || true
  fi

  [[ -f "$unit_path" ]] && mv "$unit_path" "$backup_dir/"

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload || true
  fi

  for file in \
    "${openclaw_dir}/bridge-logger.js" \
    "${openclaw_dir}/bridge-dead-letter.jsonl" \
    "${openclaw_dir}/bridge-logger.out" \
    "${openclaw_dir}/bridge-logger.err"; do
    [[ -f "$file" ]] && mv "$file" "$backup_dir/"
  done

  echo "OpenClaw bridge uninstall complete."
  echo "Backups moved to: $backup_dir"
}

# ---------------------------------------------------------------------------
# Dispatcher (root required)
# --email → full relink (bot:setup + install + service)
# no email → install + service only
# ---------------------------------------------------------------------------
do_dispatch() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Run as root (use sudo)." >&2
    exit 1
  fi

  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    APP_DIR="${APP_DIR_OVERRIDE:-${DASHBOARD_APP_DIR:-$APP_DIR}}"
    RUNTIME_USER="${RUNTIME_USER_OVERRIDE:-${DASHBOARD_RUNTIME_USER:-$RUNTIME_USER}}"
  fi

  if ! id "$RUNTIME_USER" >/dev/null 2>&1; then
    echo "Runtime user does not exist: $RUNTIME_USER" >&2
    exit 1
  fi
  if [[ ! -d "$APP_DIR" ]]; then
    echo "App dir does not exist: $APP_DIR" >&2
    exit 1
  fi

  run_as_runtime_user() {
    runuser -u "$RUNTIME_USER" -- bash -lc "$1"
  }

  if [[ -n "$EMAIL" ]]; then
    do_relink
  else
    run_as_runtime_user "cd \"$APP_DIR\" && bash scripts/bridge.sh install"
    run_as_runtime_user "cd \"$APP_DIR\" && bash scripts/bridge.sh service"
  fi

  echo
  echo "Bridge runtime status:"
  run_as_runtime_user 'systemctl --user status openclaw-bridge-logger.service --no-pager || true'
}

# ---------------------------------------------------------------------------
# Relink: run bot:setup, persist IDs to env, then install + service
# Requires root (uses runuser internally)
# ---------------------------------------------------------------------------
do_relink() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Run as root (use sudo)." >&2
    exit 1
  fi

  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    APP_DIR="${APP_DIR_OVERRIDE:-${DASHBOARD_APP_DIR:-$APP_DIR}}"
    RUNTIME_USER="${RUNTIME_USER_OVERRIDE:-${DASHBOARD_RUNTIME_USER:-$RUNTIME_USER}}"
  fi

  if [[ -z "$EMAIL" ]]; then
    echo "--email is required for relink." >&2
    exit 1
  fi
  if ! id "$RUNTIME_USER" >/dev/null 2>&1; then
    echo "Runtime user does not exist: $RUNTIME_USER" >&2
    exit 1
  fi
  if [[ ! -f "$APP_DIR/scripts/openclaw-bot-setup.mjs" ]]; then
    echo "Missing bot setup script: $APP_DIR/scripts/openclaw-bot-setup.mjs" >&2
    exit 1
  fi

  [[ -z "$WORKSPACE_ID" && -n "${OPENCLAW_WORKSPACE_ID:-}" ]] && WORKSPACE_ID="$OPENCLAW_WORKSPACE_ID"
  [[ -z "$AGENT_ID"     && -n "${OPENCLAW_AGENT_ID:-}"     ]] && AGENT_ID="$OPENCLAW_AGENT_ID"

  if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    echo "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in $ENV_FILE." >&2
    exit 1
  fi

  local resolved_db_url="${DB_URL:-${SUPABASE_DB_URL:-}}"
  if [[ -z "$resolved_db_url" ]]; then
    echo "Missing SUPABASE_DB_URL. Set it in $ENV_FILE or pass --db-url." >&2
    exit 1
  fi

  upsert_env_key() {
    local file="$1" key="$2" value="$3"
    local temp_file
    temp_file="$(mktemp)"
    if [[ -f "$file" ]]; then
      awk -v k="$key" -v v="$value" '
        BEGIN { updated = 0 }
        $0 ~ "^" k "=" { print k "=" v; updated = 1; next }
        { print }
        END { if (!updated) print k "=" v }
      ' "$file" > "$temp_file"
    else
      printf '%s=%s\n' "$key" "$value" > "$temp_file"
    fi
    install -m 640 "$temp_file" "$file"
    chown "root:${RUNTIME_USER}" "$file" || true
    rm -f "$temp_file"
  }

  local setup_cmd="cd \"$APP_DIR\" && SUPABASE_DB_URL=\"$resolved_db_url\" node --dns-result-order=ipv4first scripts/openclaw-bot-setup.mjs --email \"$EMAIL\" --json"
  [[ -n "$WORKSPACE_ID" ]] && setup_cmd="$setup_cmd --workspace-id \"$WORKSPACE_ID\""
  [[ -n "$AGENT_ID"     ]] && setup_cmd="$setup_cmd --agent-id \"$AGENT_ID\""

  local setup_output
  setup_output="$(runuser -u "$RUNTIME_USER" -- bash -lc "$setup_cmd")"

  local new_workspace_id new_agent_id
  new_workspace_id="$(printf '%s' "$setup_output" | node -e "const fs=require('node:fs');const o=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(o.workspaceId||o.env?.OPENCLAW_WORKSPACE_ID||''));")"
  new_agent_id="$(printf '%s' "$setup_output" | node -e "const fs=require('node:fs');const o=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(o.agentId||o.env?.OPENCLAW_AGENT_ID||''));")"

  if [[ -z "$new_workspace_id" || -z "$new_agent_id" ]]; then
    echo "Failed to resolve workspace/agent IDs from bot:setup output." >&2
    exit 1
  fi

  install -d "$(dirname "$ENV_FILE")"
  upsert_env_key "$ENV_FILE" "SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY"
  upsert_env_key "$ENV_FILE" "SUPABASE_DB_URL" "$resolved_db_url"
  upsert_env_key "$ENV_FILE" "OPENCLAW_WORKSPACE_ID" "$new_workspace_id"
  upsert_env_key "$ENV_FILE" "OPENCLAW_AGENT_ID" "$new_agent_id"

  runuser -u "$RUNTIME_USER" -- bash -lc "cd \"$APP_DIR\" && bash scripts/bridge.sh install"
  runuser -u "$RUNTIME_USER" -- bash -lc "cd \"$APP_DIR\" && bash scripts/bridge.sh service"

  echo "Bridge relink complete."
  echo "Workspace ID: $new_workspace_id"
  echo "Agent ID: $new_agent_id"
  echo ""
  echo "If OpenClaw gateway is running, restart it with updated env:"
  echo "sudo -u $RUNTIME_USER -H bash -lc 'set -a; source $ENV_FILE; set +a; openclaw gateway run --allow-unconfigured --bind loopback --auth token --force'"
}

# --- Route to correct handler ---
case "$SUBCOMMAND" in
  install)   do_install ;;
  service)   do_service ;;
  uninstall) do_uninstall ;;
  "")        do_dispatch ;;
esac
