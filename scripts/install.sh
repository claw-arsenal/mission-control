#!/usr/bin/env bash
# install.sh — first-time system install for OpenClaw Dashboard
#
# Sets up /etc/clawd/template.env, installs system services, clones the repo,
# builds the app, and starts all services including the task orchestrator.
#
# Usage:
#   sudo bash scripts/install.sh \
#     --repo-url git@github.com:your-org/clawd.git \
#     --next-public-supabase-url https://xxx.supabase.co \
#     --next-public-supabase-anon-key <key> \
#     --supabase-db-url postgresql://... \
#     --supabase-service-role-key <key>
#
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root (use sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_DIR="/etc/clawd"
ENV_FILE="${ENV_DIR}/template.env"
UPDATE_RUNNER="/usr/local/bin/clawd-dashboard-update"
BRIDGE_COMMAND="/usr/local/bin/dashboard-bridge"
SYSTEMD_DIR="/etc/systemd/system"

REPO_URL=""
BRANCH="main"
APP_DIR="/home/clawdbot/apps/dashboard"
RUNTIME_USER="clawdbot"
PORT="3000"
UPDATE_INTERVAL="15min"
GIT_SSH_KEY=""
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""
NEXT_PUBLIC_AGENT_DEBUG_OVERLAY="false"
SUPABASE_DB_URL=""
SUPABASE_SERVICE_ROLE_KEY=""
OPENCLAW_WORKSPACE_ID=""
OPENCLAW_AGENT_ID=""

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  REPO_URL="${DASHBOARD_REPO_URL:-$REPO_URL}"
  BRANCH="${DASHBOARD_BRANCH:-$BRANCH}"
  APP_DIR="${DASHBOARD_APP_DIR:-$APP_DIR}"
  RUNTIME_USER="${DASHBOARD_RUNTIME_USER:-$RUNTIME_USER}"
  PORT="${DASHBOARD_PORT:-$PORT}"
  GIT_SSH_KEY="${DASHBOARD_GIT_SSH_KEY:-$GIT_SSH_KEY}"
fi

print_usage() {
  cat <<'USAGE'
Usage:
  sudo bash scripts/install.sh \
    --repo-url <git-url> \
    [--branch <branch>] \
    [--app-dir </path>] \
    [--runtime-user <linux-user>] \
    [--port <3000>] \
    [--update-interval <systemd-time>] \
    [--git-ssh-key </home/clawdbot/.ssh/id_ed25519>] \
    --next-public-supabase-url <https://xxx.supabase.co> \
    --next-public-supabase-anon-key <key> \
    --supabase-db-url <postgresql://...> \
    --supabase-service-role-key <key> \
    [--openclaw-workspace-id <uuid>] \
    [--openclaw-agent-id <uuid>]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)                    REPO_URL="${2:-}";                       shift 2 ;;
    --branch)                      BRANCH="${2:-}";                         shift 2 ;;
    --app-dir)                     APP_DIR="${2:-}";                        shift 2 ;;
    --runtime-user)                RUNTIME_USER="${2:-}";                   shift 2 ;;
    --port)                        PORT="${2:-}";                           shift 2 ;;
    --update-interval)             UPDATE_INTERVAL="${2:-}";                shift 2 ;;
    --git-ssh-key)                 GIT_SSH_KEY="${2:-}";                    shift 2 ;;
    --next-public-supabase-url)    NEXT_PUBLIC_SUPABASE_URL="${2:-}";       shift 2 ;;
    --supabase-url)
      [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]] && NEXT_PUBLIC_SUPABASE_URL="${2:-}"
      shift 2 ;;
    --next-public-supabase-anon-key) NEXT_PUBLIC_SUPABASE_ANON_KEY="${2:-}"; shift 2 ;;
    --supabase-db-url)             SUPABASE_DB_URL="${2:-}";                shift 2 ;;
    --supabase-service-role-key)   SUPABASE_SERVICE_ROLE_KEY="${2:-}";      shift 2 ;;
    --openclaw-workspace-id)       OPENCLAW_WORKSPACE_ID="${2:-}";          shift 2 ;;
    --openclaw-agent-id)           OPENCLAW_AGENT_ID="${2:-}";              shift 2 ;;
    --help|-h) print_usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; print_usage; exit 1 ;;
  esac
done

if [[ -z "$REPO_URL" ]]; then
  echo "--repo-url is required." >&2
  print_usage
  exit 1
fi

if [[ -z "$BRANCH" || -z "$APP_DIR" || -z "$RUNTIME_USER" || -z "$PORT" || -z "$UPDATE_INTERVAL" ]]; then
  echo "One or more required values are empty." >&2
  exit 1
fi

if [[ -n "$GIT_SSH_KEY" && ! -f "$GIT_SSH_KEY" ]]; then
  echo "--git-ssh-key file not found: $GIT_SSH_KEY" >&2
  exit 1
fi

if ! id "$RUNTIME_USER" >/dev/null 2>&1; then
  echo "Runtime user does not exist: $RUNTIME_USER" >&2
  exit 1
fi

for cmd in git npm node systemctl runuser; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

if [[ -n "$GIT_SSH_KEY" ]] && ! command -v ssh >/dev/null 2>&1; then
  echo "Missing required command for --git-ssh-key: ssh" >&2
  exit 1
fi

# Write env file
mkdir -p "$ENV_DIR"
cat > "$ENV_FILE" <<EOF
DASHBOARD_REPO_URL=$REPO_URL
DASHBOARD_BRANCH=$BRANCH
DASHBOARD_APP_DIR=$APP_DIR
DASHBOARD_RUNTIME_USER=$RUNTIME_USER
DASHBOARD_PORT=$PORT
DASHBOARD_GIT_SSH_KEY=$GIT_SSH_KEY
DASHBOARD_GIT_SSH_STRICT_HOST_KEY_CHECKING=accept-new
NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_AGENT_DEBUG_OVERLAY=$NEXT_PUBLIC_AGENT_DEBUG_OVERLAY
SUPABASE_DB_URL=$SUPABASE_DB_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
OPENCLAW_WORKSPACE_ID=$OPENCLAW_WORKSPACE_ID
OPENCLAW_AGENT_ID=$OPENCLAW_AGENT_ID
EOF
chown "root:${RUNTIME_USER}" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# Install system commands and services
install -m 755 "${REPO_ROOT}/scripts/update.sh"   "$UPDATE_RUNNER"
install -m 755 "${REPO_ROOT}/scripts/bridge.sh"   "$BRIDGE_COMMAND"
install -m 644 "${REPO_ROOT}/scripts/systemd/dashboard-pull.service" "${SYSTEMD_DIR}/dashboard-pull.service"

sed "s|@@RUNTIME_USER@@|${RUNTIME_USER}|g" \
  "${REPO_ROOT}/scripts/systemd/clawd-dashboard.service" \
  > "${SYSTEMD_DIR}/clawd-dashboard.service"
chmod 644 "${SYSTEMD_DIR}/clawd-dashboard.service"

sed "s|@@UPDATE_INTERVAL@@|${UPDATE_INTERVAL}|g" \
  "${REPO_ROOT}/scripts/systemd/dashboard-pull.timer" \
  > "${SYSTEMD_DIR}/dashboard-pull.timer"
chmod 644 "${SYSTEMD_DIR}/dashboard-pull.timer"

# Remove legacy units and commands
systemctl disable --now clawd-pull.timer           >/dev/null 2>&1 || true
systemctl stop    clawd-pull.service               >/dev/null 2>&1 || true
systemctl disable --now clawd-autoupdate.timer     >/dev/null 2>&1 || true
systemctl disable --now clawd-autoupdate.service   >/dev/null 2>&1 || true
rm -f "${SYSTEMD_DIR}/clawd-pull.service"
rm -f "${SYSTEMD_DIR}/clawd-pull.timer"
rm -f "${SYSTEMD_DIR}/clawd-autoupdate.service"
rm -f "${SYSTEMD_DIR}/clawd-autoupdate.timer"
rm -f /usr/local/bin/clawd-pull
rm -f /usr/local/bin/clawd-autoupdate.sh
rm -f /usr/local/bin/clawd-dashboard-update.sh   # old name
rm -f /usr/local/bin/dashboard-pull              # superseded by dashboard update

# Install task orchestrator as user systemd service
TASK_SERVICE_SRC="${REPO_ROOT}/scripts/systemd/openclaw-task-orchestrator.service"
TASK_SERVICE_DST="${HOME}/.config/systemd/user/openclaw-task-orchestrator.service"
if [[ -f "$TASK_SERVICE_SRC" ]]; then
  RUNTIME_HOME="$(getent passwd "$RUNTIME_USER" | cut -d: -f6)"
  TASK_SERVICE_USER_DIR="${RUNTIME_HOME}/.config/systemd/user"
  mkdir -p "$TASK_SERVICE_USER_DIR"
  install -m 644 "$TASK_SERVICE_SRC" "${TASK_SERVICE_USER_DIR}/openclaw-task-orchestrator.service"
  runuser -u "$RUNTIME_USER" -- systemctl --user daemon-reload
  runuser -u "$RUNTIME_USER" -- systemctl --user enable --now openclaw-task-orchestrator.service
fi

systemctl daemon-reload

# Clone/pull, build, and start
"$UPDATE_RUNNER" "$ENV_FILE"

systemctl enable --now clawd-dashboard.service
systemctl enable --now dashboard-pull.timer

systemctl status clawd-dashboard.service --no-pager
systemctl status dashboard-pull.timer --no-pager

echo ""
echo "Install complete."
echo "  Manual update:     sudo dashboard update"
echo "  Connect bridge:    sudo dashboard bridge --email your@email.com"
