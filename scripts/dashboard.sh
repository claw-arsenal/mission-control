#!/usr/bin/env bash
# dashboard — unified management for OpenClaw Dashboard
#
# Install as a system command once:
#   sudo install -m 755 /home/clawdbot/apps/dashboard/scripts/dashboard.sh /usr/local/bin/dashboard
#
# Usage:
#   sudo dashboard install [--email EMAIL]             first-time install
#   sudo dashboard update                              pull latest, rebuild, restart all
#   sudo dashboard bridge [--email EMAIL]              set up or repair bridge runtime
#   sudo dashboard status                              show all service and bridge status
#   sudo dashboard uninstall [--purge-app] [--purge-env] [--purge-db]
#
set -euo pipefail

COMMAND="${1:-help}"
shift || true

ENV_FILE="/etc/clawd/template.env"
RUNTIME_USER="clawdbot"
APP_DIR="/home/clawdbot/apps/dashboard"
SCRIPT_DIR="$APP_DIR/scripts"

_load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "❌  Missing env file: $ENV_FILE" >&2
    echo "    Create it first — see README for required keys." >&2
    exit 1
  fi
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
  APP_DIR="${DASHBOARD_APP_DIR:-$APP_DIR}"
  RUNTIME_USER="${DASHBOARD_RUNTIME_USER:-$RUNTIME_USER}"
  SCRIPT_DIR="$APP_DIR/scripts"
}

_require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "❌  Run with sudo." >&2
    exit 1
  fi
}

_run_script() {
  local script="$1"
  shift
  local path="$SCRIPT_DIR/$script"
  if [[ ! -f "$path" ]]; then
    echo "❌  Script not found: $path" >&2
    exit 1
  fi
  chmod +x "$path"
  bash "$path" "$@"
}

cmd_install() {
  _require_root
  local email=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --email) email="$2"; shift 2 ;;
      *) echo "Unknown flag: $1" >&2; exit 1 ;;
    esac
  done

  _load_env

  required=(
    NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
    SUPABASE_DB_URL SUPABASE_SERVICE_ROLE_KEY
  )
  for key in "${required[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      echo "❌  Missing required key in $ENV_FILE: $key" >&2
      exit 1
    fi
  done

  echo "▶  Installing services..."
  _run_script install.sh \
    --repo-url "${DASHBOARD_REPO_URL:-git@github.com:carterassist/dashboard.git}" \
    --branch "${DASHBOARD_BRANCH:-main}" \
    --app-dir "$APP_DIR" \
    --runtime-user "$RUNTIME_USER" \
    --port "${DASHBOARD_PORT:-3000}" \
    --update-interval "${DASHBOARD_UPDATE_INTERVAL:-15min}" \
    --git-ssh-key "${DASHBOARD_GIT_SSH_KEY:-/home/$RUNTIME_USER/.ssh/id_ed25519}" \
    --next-public-supabase-url "$NEXT_PUBLIC_SUPABASE_URL" \
    --next-public-supabase-anon-key "$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    --supabase-db-url "$SUPABASE_DB_URL" \
    --supabase-service-role-key "$SUPABASE_SERVICE_ROLE_KEY"

  echo "▶  Pulling and building..."
  systemctl start dashboard-pull.service

  echo "▶  Setting up database..."
  runuser -u "$RUNTIME_USER" -- bash -lc "cd '$APP_DIR' && npm run db:setup"

  echo "▶  Installing task orchestrator..."
  install -m 644 "$SCRIPT_DIR/openclaw-task-orchestrator.service" \
    /etc/systemd/system/openclaw-task-orchestrator.service

  echo "▶  Installing watchdog..."
  install -m 644 "$SCRIPT_DIR/openclaw-dashboard-watchdog.service" \
    /etc/systemd/system/openclaw-dashboard-watchdog.service
  install -m 644 "$SCRIPT_DIR/openclaw-dashboard-watchdog.timer" \
    /etc/systemd/system/openclaw-dashboard-watchdog.timer

  systemctl daemon-reload
  systemctl enable --now openclaw-task-orchestrator.service
  systemctl enable --now openclaw-dashboard-watchdog.timer

  if [[ -n "$email" ]]; then
    echo "▶  Setting up bridge..."
    cmd_bridge --email "$email"
  fi

  echo ""
  cmd_status
  echo ""
  echo "✅  Install complete."
  [[ -z "$email" ]] && echo "    Run 'sudo dashboard bridge --email you@example.com' to connect OpenClaw."
}

cmd_update() {
  _require_root
  _load_env

  echo "▶  Pulling latest code and rebuilding..."
  _run_script update.sh "$ENV_FILE"

  echo ""
  echo "✅  Update complete."
}

cmd_bridge() {
  _require_root
  _load_env

  _run_script bridge.sh "$@"
}

cmd_status() {
  _require_root

  echo "── Services ──────────────────────────────────"
  for svc in clawd-dashboard.service openclaw-task-orchestrator.service \
              dashboard-pull.timer openclaw-dashboard-watchdog.timer; do
    if systemctl list-unit-files "$svc" --no-legend 2>/dev/null | grep -q .; then
      status=$(systemctl is-active "$svc" 2>/dev/null || echo "inactive")
      printf "  %-42s %s\n" "$svc" "$status"
    fi
  done

  echo ""
  echo "── Bridge ────────────────────────────────────"
  if id "$RUNTIME_USER" >/dev/null 2>&1; then
    runuser -u "$RUNTIME_USER" -- bash -lc \
      'systemctl --user is-active openclaw-bridge-logger.service 2>/dev/null && echo "  bridge-logger  active" || echo "  bridge-logger  inactive"' \
      2>/dev/null || true
  fi
  echo ""
}

cmd_uninstall() {
  _require_root
  _load_env
  _run_script uninstall.sh \
    --runtime-user "$RUNTIME_USER" \
    --app-dir "$APP_DIR" \
    "$@"
}

cmd_help() {
  cat <<'EOF'
dashboard — OpenClaw Dashboard management

Usage:
  sudo dashboard install [--email EMAIL]             First-time install
  sudo dashboard update                              Pull, rebuild, restart
  sudo dashboard bridge [--email EMAIL]              Setup or repair bridge
  sudo dashboard status                              Service status overview
  sudo dashboard uninstall [--purge-app] [--purge-env] [--purge-db]

Options for uninstall:
  --purge-app   Delete app directory
  --purge-env   Delete /etc/clawd/template.env
  --purge-db    Drop all database tables
EOF
}

case "$COMMAND" in
  install)   cmd_install "$@" ;;
  update)    cmd_update ;;
  bridge)    cmd_bridge "$@" ;;
  status)    cmd_status ;;
  uninstall) cmd_uninstall "$@" ;;
  help|--help|-h) cmd_help ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    cmd_help
    exit 1
    ;;
esac
