#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Uninstall Script
# Completely removes the Mission Control installation including:
#   - All Docker containers and volumes
#   - The project directory
#   - Convenience symlinks in /usr/local/bin
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[uninstall]${NC} $1"; }
warn()  { echo -e "${YELLOW}[uninstall]${NC} $1"; }
err()   { echo -e "${RED}[uninstall]${NC} $1" >&2; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║       OpenClaw Mission Control — Uninstall           ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ── Confirm ─────────────────────────────────────────────────
warn "This will PERMANENTLY remove:"
echo "  1. All Docker containers and volumes"
echo "  2. The project directory: $PROJECT_ROOT"
echo "  3. Convenience symlinks: /usr/local/bin/mc-{install,clean,update,uninstall}"
echo ""
warn "Your .env file will be DELETED (database passwords, API credentials)."
echo ""
read -rp "Type 'yes' to confirm: " confirm
if [ "$confirm" != "yes" ]; then
  info "Aborted."
  exit 0
fi
echo ""

# ── Stop and remove Docker ──────────────────────────────────
info "Stopping Docker services ..."
cd "$PROJECT_ROOT"
docker compose down --volumes --remove-orphans 2>&1 | tail -3 || true

# Remove dangling images built for this project
info "Removing project Docker images ..."
docker images --format '{{.Repository}}' | grep -E "mission-control|bridge-logger|task-worker|gateway-sync" | while read -r img; do
  docker rmi -f "$img" 2>/dev/null && echo "  Removed: $img" || true
done

# ── Remove convenience symlinks ───────────────────────────────
info "Removing convenience symlinks ..."
for script in install clean update uninstall; do
  symlink="/usr/local/bin/mc-${script}"
  if [ -L "$symlink" ]; then
    rm -f "$symlink"
    echo "  Removed: $symlink"
  fi
done

# ── Remove project directory ────────────────────────────────
info "Removing project directory ..."
rm -rf "$PROJECT_ROOT"
echo "  Removed: $PROJECT_ROOT"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║         Uninstall complete.                         ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
info "Mission Control has been completely removed."
echo ""
