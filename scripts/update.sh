#!/usr/bin/env bash
# update.sh — pull latest code, rebuild, and restart all dashboard services
#
# Usage:
#   sudo update.sh [/path/to/template.env]
#   (called automatically by dashboard-pull.service on a timer)
#
set -euo pipefail

ENV_FILE="${1:-/etc/clawd/template.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

source "$ENV_FILE"

DASHBOARD_REPO_URL="${DASHBOARD_REPO_URL:-}"
DASHBOARD_BRANCH="${DASHBOARD_BRANCH:-}"
DASHBOARD_APP_DIR="${DASHBOARD_APP_DIR:-}"
DASHBOARD_RUNTIME_USER="${DASHBOARD_RUNTIME_USER:-}"
DASHBOARD_PORT="${DASHBOARD_PORT:-}"
DASHBOARD_GIT_SSH_KEY="${DASHBOARD_GIT_SSH_KEY:-}"
DASHBOARD_GIT_SSH_STRICT_HOST_KEY_CHECKING="${DASHBOARD_GIT_SSH_STRICT_HOST_KEY_CHECKING:-accept-new}"

required_keys=(
  DASHBOARD_REPO_URL
  DASHBOARD_BRANCH
  DASHBOARD_APP_DIR
  DASHBOARD_RUNTIME_USER
  DASHBOARD_PORT
)

for key in "${required_keys[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required key in env file: $key" >&2
    exit 1
  fi
done

if ! id "$DASHBOARD_RUNTIME_USER" >/dev/null 2>&1; then
  echo "Runtime user does not exist: $DASHBOARD_RUNTIME_USER" >&2
  exit 1
fi

for cmd in git npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd is not installed." >&2
    exit 1
  fi
done

if [[ -n "${DASHBOARD_GIT_SSH_KEY:-}" ]] && ! command -v ssh >/dev/null 2>&1; then
  echo "ssh is required when DASHBOARD_GIT_SSH_KEY is set." >&2
  exit 1
fi

run_as_runtime_user() {
  runuser -u "$DASHBOARD_RUNTIME_USER" -- bash -lc "$1"
}

run_git_as_runtime_user() {
  if [[ -n "${DASHBOARD_GIT_SSH_KEY:-}" ]]; then
    if [[ ! -f "${DASHBOARD_GIT_SSH_KEY}" ]]; then
      echo "Configured DASHBOARD_GIT_SSH_KEY does not exist: ${DASHBOARD_GIT_SSH_KEY}" >&2
      exit 1
    fi
    local ssh_strict="${DASHBOARD_GIT_SSH_STRICT_HOST_KEY_CHECKING:-accept-new}"
    local ssh_cmd="ssh -i \"${DASHBOARD_GIT_SSH_KEY}\" -o IdentitiesOnly=yes -o StrictHostKeyChecking=${ssh_strict}"
    runuser -u "$DASHBOARD_RUNTIME_USER" -- env GIT_SSH_COMMAND="$ssh_cmd" bash -lc "$1"
    return
  fi
  run_as_runtime_user "$1"
}

sync_dashboard_env_file() {
  local temp_env
  temp_env="$(mktemp)"
  cat > "$temp_env" <<EOF
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
NEXT_PUBLIC_AGENT_DEBUG_OVERLAY=${NEXT_PUBLIC_AGENT_DEBUG_OVERLAY:-false}
SUPABASE_DB_URL=${SUPABASE_DB_URL}
EOF
  install -o "$DASHBOARD_RUNTIME_USER" -g "$DASHBOARD_RUNTIME_USER" -m 600 "$temp_env" "$DASHBOARD_APP_DIR/.env.local"
  rm -f "$temp_env"
}

refresh_bridge_launcher() {
  if [[ -z "${OPENCLAW_WORKSPACE_ID:-}" || -z "${OPENCLAW_AGENT_ID:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    return
  fi
  if [[ ! -f "$DASHBOARD_APP_DIR/scripts/bridge.sh" ]]; then
    return
  fi
  if ! run_as_runtime_user "cd \"$DASHBOARD_APP_DIR\" && bash scripts/bridge.sh install >/dev/null"; then
    echo "[clawd-update] warning: bridge launcher refresh failed; keeping existing bridge runtime." >&2
  fi
}

restart_bridge_logger_runtime() {
  run_as_runtime_user "systemctl --user restart openclaw-bridge-logger.service >/dev/null 2>&1 || true"
  run_as_runtime_user "
if [[ -r \"$ENV_FILE\" ]]; then
  set -a
  source \"$ENV_FILE\"
  set +a
fi
export PATH=\"\$HOME/.npm-global/bin:\$PATH\"
"
}

echo "[clawd-update] repo: $DASHBOARD_REPO_URL"
echo "[clawd-update] branch: $DASHBOARD_BRANCH"
echo "[clawd-update] app dir: $DASHBOARD_APP_DIR"

if [[ ! -d "$DASHBOARD_APP_DIR/.git" ]]; then
  echo "[clawd-update] repo missing, cloning..."
  install -d -o "$DASHBOARD_RUNTIME_USER" -g "$DASHBOARD_RUNTIME_USER" "$(dirname "$DASHBOARD_APP_DIR")"
  run_git_as_runtime_user "git clone --branch \"$DASHBOARD_BRANCH\" \"$DASHBOARD_REPO_URL\" \"$DASHBOARD_APP_DIR\""
else
  echo "[clawd-update] repo found, pulling latest..."
  dirty_state="$(run_git_as_runtime_user "cd \"$DASHBOARD_APP_DIR\" && git status --porcelain")"
  if [[ -n "$dirty_state" ]]; then
    echo "[clawd-update] local changes detected in $DASHBOARD_APP_DIR. Skipping auto update." >&2
    exit 1
  fi
  run_git_as_runtime_user "cd \"$DASHBOARD_APP_DIR\" && git remote set-url origin \"$DASHBOARD_REPO_URL\""
  run_git_as_runtime_user "cd \"$DASHBOARD_APP_DIR\" && git fetch --prune origin \"$DASHBOARD_BRANCH\""
  run_git_as_runtime_user "cd \"$DASHBOARD_APP_DIR\" && git checkout \"$DASHBOARD_BRANCH\" || git checkout -b \"$DASHBOARD_BRANCH\" \"origin/$DASHBOARD_BRANCH\""
  run_git_as_runtime_user "cd \"$DASHBOARD_APP_DIR\" && git pull --ff-only origin \"$DASHBOARD_BRANCH\""
fi

required_dashboard_env_keys=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_DB_URL
)

missing_dashboard_env_keys=()
for key in "${required_dashboard_env_keys[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing_dashboard_env_keys+=("$key")
  fi
done

if [[ ${#missing_dashboard_env_keys[@]} -gt 0 ]]; then
  echo "[clawd-update] missing required dashboard env keys in $ENV_FILE:" >&2
  for key in "${missing_dashboard_env_keys[@]}"; do
    echo "  - $key" >&2
  done
  echo "[clawd-update] add missing keys to $ENV_FILE, then rerun update." >&2
  exit 1
fi

sync_dashboard_env_file
run_as_runtime_user "cd \"$DASHBOARD_APP_DIR\" && npm ci --no-audit --no-fund"
refresh_bridge_launcher
run_as_runtime_user "cd \"$DASHBOARD_APP_DIR\" && npm run build"

if systemctl list-unit-files | grep -q '^clawd-dashboard.service'; then
  systemctl restart clawd-dashboard.service
fi

restart_bridge_logger_runtime

echo "[clawd-update] completed successfully."
