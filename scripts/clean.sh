#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Clean Script
# Stops all services, removes all containers and volumes,
# then re-initializes from the latest git state.
# Use when you want a fresh start without re-cloning.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[clean]${NC} $1"; }
warn()  { echo -e "${YELLOW}[clean]${NC} $1"; }
err()   { echo -e "${RED}[clean]${NC} $1" >&2; }
step()  { echo -e "${CYAN}[clean]${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║       OpenClaw Mission Control — Clean                ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ── Confirm ─────────────────────────────────────────────────
if [ ! -d .git ]; then
  err "Not a git repository. Run install.sh first."
  exit 1
fi

warn "This will:"
echo "  1. Stop all running Docker containers"
echo "  2. Remove all Docker containers (not images)"
echo "  3. Remove all named Docker volumes (including database)"
echo "  4. Keep your .env file"
echo "  5. Git pull latest"
echo "  6. Rebuild and restart all services"
echo ""
read -rp "Continue? [y/N] " confirm
if [ "${confirm,,}" != "y" ]; then
  info "Aborted."
  exit 0
fi
echo ""

# ── Stop all services ─────────────────────────────────────────
step "Stopping all services ..."
docker compose down 2>&1 | tail -3 || true

# ── Remove containers ─────────────────────────────────────────
step "Removing containers ..."
docker compose rm -f 2>&1 | grep -v "^$" | tail -5 || true

# ── Remove volumes ───────────────────────────────────────────
step "Removing volumes (this destroys the database) ..."
docker compose down --volumes 2>&1 | tail -3 || true

# ── Pull latest ──────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
step "Pulling latest changes (branch: $CURRENT_BRANCH) ..."
git pull origin "$CURRENT_BRANCH" 2>&1 | tail -3

# ── Sync .env.local ──────────────────────────────────────────
if [ -f .env ]; then
  step "Syncing .env to .env.local ..."
  cp .env .env.local
fi

# ── Recreate runtime dir ─────────────────────────────────────
mkdir -p .runtime/bridge-logger
touch .runtime/bridge-logger/bridge-logger.lock
chmod 666 .runtime/bridge-logger/bridge-logger.lock

# ── Rebuild Docker images ────────────────────────────────────
step "Rebuilding Docker images ..."
docker compose build --pull bridge-logger task-worker gateway-sync 2>&1 | tail -3

# ── Start services ──────────────────────────────────────────
step "Starting database ..."
docker compose up -d db
docker compose up -d db-init

step "Waiting for database to be ready ..."
until docker compose exec -T db pg_isready -U openclaw -d mission_control >/dev/null 2>&1; do
  printf "."
  sleep 1
done
echo ""
info "Database ready."

step "Waiting for schema initialization ..."
while docker compose ps db-init 2>/dev/null | grep -q "Up"; do
  printf "."
  sleep 1
done
echo ""
info "Schema initialized."

step "Starting all services ..."
docker compose up -d --build bridge-logger task-worker gateway-sync

# ── npm install ──────────────────────────────────────────────
step "Installing npm dependencies ..."
npm install 2>&1 | tail -3

# ── Verify ───────────────────────────────────────────────────
sleep 3
echo ""
info "Service status:"
printf "  %-20s %s\n" "db"            "$(docker compose ps db --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
printf "  %-20s %s\n" "bridge-logger" "$(docker compose ps bridge-logger --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
printf "  %-20s %s\n" "task-worker"   "$(docker compose ps task-worker --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
printf "  %-20s %s\n" "gateway-sync"  "$(docker compose ps gateway-sync --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
echo ""

info "Clean complete — all services restarted with latest code."
echo ""
