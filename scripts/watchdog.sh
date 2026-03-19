#!/usr/bin/env bash
# watchdog.sh — check dashboard health and send an alert if it's down
#
# Run on a timer (e.g. every 5 minutes via openclaw-dashboard-watchdog.timer).
# Sends one alert when the dashboard goes down, and one when it recovers.
# State is persisted to ~/.openclaw/dashboard-watchdog-state.
#
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
ENV_FILE="${DASHBOARD_ENV_PATH:-/etc/clawd/template.env}"
STATE_FILE="$OPENCLAW_HOME/dashboard-watchdog-state"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PORT="${DASHBOARD_PORT:-3000}"
URL="${DASHBOARD_HEALTH_URL:-http://127.0.0.1:${PORT}/login}"
ALERT_CHANNEL="${DASHBOARD_ALERT_CHANNEL:-telegram}"
ALERT_TARGET="${DASHBOARD_ALERT_TARGET:-839196934}"

status="ok"
reason=""

if ! curl -fsS --max-time 5 "$URL" >/dev/null 2>&1; then
  status="down"
  reason="Dashboard HTTP healthcheck failed at ${URL}."
fi

if [[ "$status" == "ok" ]] && ! systemctl is-active --quiet clawd-dashboard.service; then
  status="down"
  reason="Systemd service clawd-dashboard.service is not active."
fi

last="unknown"
if [[ -f "$STATE_FILE" ]]; then
  last="$(cat "$STATE_FILE" 2>/dev/null || echo unknown)"
fi

echo "$status" > "$STATE_FILE"

send_alert() {
  openclaw message send \
    --channel "$ALERT_CHANNEL" \
    --target "$ALERT_TARGET" \
    --message "$1" >/dev/null 2>&1 || true
}

if [[ "$status" == "down" && "$last" != "down" ]]; then
  send_alert "Dashboard is unreachable. ${reason}

Quick fix:
1) sudo systemctl status clawd-dashboard.service --no-pager
2) sudo journalctl -u clawd-dashboard.service -n 120 --no-pager
3) sudo dashboard update
4) sudo systemctl restart clawd-dashboard.service"
elif [[ "$status" == "ok" && "$last" == "down" ]]; then
  send_alert "Dashboard recovered and is reachable again on ${URL}."
fi
