#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Service Supervisor
# Manages task-worker, gateway-sync, and bridge-logger as
# background daemons using simple PID files.
#
# Usage:
#   mc-services start     — start all three services
#   mc-services stop      — stop all three services
#   mc-services restart   — stop then start
#   mc-services status    — show running status + last 5 log lines
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="$PROJECT_ROOT/.runtime"
PID_DIR="$RUNTIME_DIR/pids"
LOG_DIR="$RUNTIME_DIR/logs"

# Load .env if present
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Defaults
DATABASE_URL="${DATABASE_URL:-postgresql://openclaw:${POSTGRES_PASSWORD}@127.0.0.1:5432/mission_control}"
OPENCLAW_DATABASE_URL="${OPENCLAW_DATABASE_URL:-$DATABASE_URL}"
OPENCLAW_GATEWAY_URL="${OPENCLAW_GATEWAY_URL:-ws://127.0.0.1:18789}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"

mkdir -p "$PID_DIR" "$LOG_DIR"

# ── Service definitions ─────────────────────────────────────
SERVICES="task-worker gateway-sync bridge-logger"

declare -A SERVICE_CMDS
declare -A SERVICE_LOG_FILES
declare -A SERVICE_PIDS

for svc in $SERVICES; do
  SERVICE_PIDS[$svc]="$PID_DIR/${svc}.pid"
  SERVICE_LOG_FILES[$svc]="$LOG_DIR/${svc}.log"
done

SERVICE_CMDS[task-worker]="node scripts/task-worker.mjs"
SERVICE_CMDS[gateway-sync]="node scripts/gateway-sync.mjs"
SERVICE_CMDS[bridge-logger]="node scripts/bridge-logger.mjs"

# ── Helpers ────────────────────────────────────────────────
pid_running() {
  local pid=$1
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

start_service() {
  local svc=$1
  local pid_file="${SERVICE_PIDS[$svc]}"
  local log_file="${SERVICE_LOG_FILES[$svc]}"
  local cmd="${SERVICE_CMDS[$svc]}"

  if pid_running "$(cat "$pid_file" 2>/dev/null)"; then
    echo "  $svc — already running (pid $(cat "$pid_file"))"
    return 0
  fi

  echo -n "  Starting $svc... "
  cd "$PROJECT_ROOT"
  (
    exec ${cmd} >> "$log_file" 2>&1
  ) &
  local new_pid=$!
  echo "$new_pid" > "$pid_file"
  sleep 0.5
  if pid_running "$new_pid"; then
    echo "pid $new_pid"
  else
    echo "FAILED — check $log_file"
    rm -f "$pid_file"
    return 1
  fi
}

stop_service() {
  local svc=$1
  local pid_file="${SERVICE_PIDS[$svc]}"

  if [ ! -f "$pid_file" ]; then
    echo "  $svc — not running (no pid file)"
    return 0
  fi

  local pid=$(cat "$pid_file")
  if pid_running "$pid"; then
    echo -n "  Stopping $svc (pid $pid)... "
    kill "$pid" 2>/dev/null
    local count=0
    while pid_running "$pid" && [ $count -lt 10 ]; do
      sleep 0.5
      count=$((count + 1))
    done
    if pid_running "$pid"; then
      kill -9 "$pid" 2>/dev/null
      sleep 0.2
    fi
    echo "stopped"
  else
    echo "  $svc — not running (stale pid file)"
  fi
  rm -f "$pid_file"
}

status_service() {
  local svc=$1
  local pid_file="${SERVICE_PIDS[$svc]}"
  local log_file="${SERVICE_LOG_FILES[$svc]}"

  if pid_running "$(cat "$pid_file" 2>/dev/null)"; then
    echo "  $svc — RUNNING (pid $(cat "$pid_file"))"
    [ -f "$log_file" ] && echo "    Last lines:" && tail -3 "$log_file" | sed 's/^/      /'
  else
    echo "  $svc — STOPPED"
    [ -f "$log_file" ] && tail -3 "$log_file" | grep -v "^$" | sed 's/^/    log: /' || true
  fi
}

# ── Commands ───────────────────────────────────────────────
CMD="${1:-status}"

case "$CMD" in
  start)
    echo "[mc-services] Starting services..."
    for svc in $SERVICES; do
      start_service "$svc"
    done
    echo "[mc-services] All services started."
    ;;
  stop)
    echo "[mc-services] Stopping services..."
    for svc in $SERVICES; do
      stop_service "$svc"
    done
    echo "[mc-services] All services stopped."
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    echo "[mc-services] Service status:"
    for svc in $SERVICES; do
      status_service "$svc"
    done
    ;;
  *)
    echo "Usage: mc-services {start|stop|restart|status}"
    exit 1
    ;;
esac
