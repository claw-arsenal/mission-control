#!/usr/bin/env bash
# OpenClaw Mission Control — Development Mode
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"
RED='[0;31m'; GREEN='[0;32m'; YELLOW='[1;33m'; CYAN='[0;36m'; NC='[0m'
info() { echo -e "${GREEN}[dev]${NC} $1"; }
step() { echo -e "${CYAN}[dev]${NC} $1"; }
echo ""
echo "========================================"
echo "  OpenClaw Mission Control — Dev Mode"
echo "========================================"
echo ""
CMD="${1:-start}"
stop_dev() {
  echo ""
  info "Stopping all services..."
  bash scripts/mc-services.sh stop 2>&1 | sed 's/^/  /' || true
  docker compose stop db 2>&1 | sed 's/^/  /' || true
  info "All services stopped."
  exit 0
}
if [ "$CMD" = "stop" ]; then stop_dev; fi
if [ "$CMD" != "start" ]; then echo "Usage: bash dev.sh {start|stop}"; exit 1; fi
if ! docker compose ps db 2>/dev/null | grep -q "Up"; then
  step "Starting Docker database..."
  docker compose up -d db db-init
  until docker compose exec -T db pg_isready -U openclaw -d mission_control >/dev/null 2>&1; do printf "."; sleep 1; done
  echo ""
  while docker compose ps db-init 2>/dev/null | grep -q "Up"; do printf "."; sleep 1; done
  echo ""; info "Database ready."
else
  info "Database already running."
fi
step "Starting host services..."
bash scripts/mc-services.sh start 2>&1 | sed 's/^/  /'
echo ""
echo "Dev mode started — http://localhost:3000"
echo "Press Ctrl+C to stop all services."
trap "stop_dev" INT TERM
wait
