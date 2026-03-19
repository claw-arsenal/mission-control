#!/usr/bin/env bash
# uninstall.sh — stop and remove all OpenClaw Dashboard services and files
#
# Usage:
#   sudo bash scripts/uninstall.sh [options]
#
# Options:
#   --purge-app       Delete the app directory
#   --purge-env       Delete /etc/clawd/template.env
#   --purge-db        Drop all dashboard database tables
#   --runtime-user    Runtime user (default: clawdbot)
#   --app-dir         App directory (default: /home/clawdbot/apps/dashboard)
#   --env-file        Env file path (default: /etc/clawd/template.env)
#
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root (use sudo)." >&2
  exit 1
fi

ENV_FILE="/etc/clawd/template.env"
RUNTIME_USER="clawdbot"
APP_DIR="/home/clawdbot/apps/dashboard"
PURGE_APP="false"
PURGE_ENV="false"
PURGE_DB="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)      ENV_FILE="$2";      shift 2 ;;
    --runtime-user)  RUNTIME_USER="$2";  shift 2 ;;
    --app-dir)       APP_DIR="$2";       shift 2 ;;
    --purge-app)     PURGE_APP="true";   shift ;;
    --purge-env)     PURGE_ENV="true";   shift ;;
    --purge-db)      PURGE_DB="true";    shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

echo "[uninstall] stopping and disabling services"
for svc in \
  clawd-dashboard.service \
  dashboard-pull.timer \
  dashboard-pull.service \
  openclaw-task-orchestrator.service \
  openclaw-dashboard-watchdog.timer \
  openclaw-dashboard-watchdog.service; do
  systemctl disable --now "$svc" 2>/dev/null || true
done

# Legacy units (safe no-op if missing)
for svc in clawd-pull.timer clawd-pull.service clawd-autoupdate.timer clawd-autoupdate.service; do
  systemctl disable --now "$svc" 2>/dev/null || true
done

SYSTEMD_DIR="/etc/systemd/system"
for file in \
  clawd-dashboard.service \
  dashboard-pull.service \
  dashboard-pull.timer \
  openclaw-task-orchestrator.service \
  openclaw-dashboard-watchdog.service \
  openclaw-dashboard-watchdog.timer \
  clawd-pull.service \
  clawd-pull.timer \
  clawd-autoupdate.service \
  clawd-autoupdate.timer; do
  rm -f "${SYSTEMD_DIR}/${file}"
done

for cmd in \
  /usr/local/bin/clawd-dashboard-update \
  /usr/local/bin/clawd-dashboard-update.sh \
  /usr/local/bin/dashboard-pull \
  /usr/local/bin/dashboard-bridge \
  /usr/local/bin/clawd-pull \
  /usr/local/bin/clawd-autoupdate.sh; do
  rm -f "$cmd"
done

systemctl daemon-reload

echo "[uninstall] uninstalling bridge runtime"
if id -u "$RUNTIME_USER" >/dev/null 2>&1; then
  if [[ -x "$APP_DIR/scripts/bridge.sh" ]]; then
    runuser -u "$RUNTIME_USER" -- bash -lc "cd '$APP_DIR' && bash scripts/bridge.sh uninstall" || true
  else
    # Fallback if repo is already gone
    runuser -u "$RUNTIME_USER" -- bash -lc "
      systemctl --user disable --now openclaw-bridge-logger.service || true
      rm -f ~/.config/systemd/user/openclaw-bridge-logger.service
      systemctl --user daemon-reload || true
    " || true
  fi
fi

if [[ "$PURGE_DB" == "true" ]]; then
  echo "[uninstall] purging dashboard db tables"
  if [[ -d "$APP_DIR" ]]; then
    runuser -u "$RUNTIME_USER" -- bash -lc "cd '$APP_DIR' && printf 'yes\n' | npm run db:reset"
  fi
fi

if [[ "$PURGE_APP" == "true" ]]; then
  echo "[uninstall] removing app dir: $APP_DIR"
  rm -rf "$APP_DIR"
fi

if [[ "$PURGE_ENV" == "true" ]]; then
  echo "[uninstall] removing env file: $ENV_FILE"
  rm -f "$ENV_FILE"
fi

echo ""
echo "Uninstall complete."
echo "Kept by default (pass flags to remove):"
[[ "$PURGE_ENV" != "true" ]] && echo "  $ENV_FILE (use --purge-env)"
[[ "$PURGE_APP" != "true" ]] && echo "  $APP_DIR (use --purge-app)"
