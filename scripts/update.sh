#!/usr/bin/env bash
# ============================================================
# OpenClaw Mission Control — Update Script
# Pulls latest git changes, rebuilds changed images/services,
# and updates the codebase where needed.
# Safe to run on an existing install.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[update]${NC} $1"; }
warn()  { echo -e "${YELLOW}[update]${NC} $1"; }
err()   { echo -e "${RED}[update]${NC} $1" >&2; }
step()  { echo -e "${CYAN}[update]${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║       OpenClaw Mission Control — Update               ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ── Must be inside a git repo ───────────────────────────────
if [ ! -d .git ]; then
  err "Not a git repository. Run install.sh first."
  exit 1
fi

# ── Capture state before pull ────────────────────────────────
INSTALLED_SCRIPTS_BEFORE=$(ls scripts/*.sh 2>/dev/null | xargs -I{} basename {} .sh | sort)
NEED_NPM="no"

# ── Git pull ────────────────────────────────────────────────
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
info "Branch: $CURRENT_BRANCH"
step "Pulling latest changes ..."
git pull origin "$CURRENT_BRANCH" 2>&1 | tail -3

# ── Detect changed files ─────────────────────────────────────
CHANGED_FILES=$(git diff HEAD~1 --name-only 2>/dev/null || echo "")
CHANGED_NM="no"
if echo "$CHANGED_FILES" | grep -qE "package\.json|package-lock\.json"; then
  NEED_NPM="yes"
  CHANGED_NM="yes"
fi

# ── Detect new/removed scripts ───────────────────────────────
INSTALLED_SCRIPTS_AFTER=$(ls scripts/*.sh 2>/dev/null | xargs -I{} basename {} .sh | sort)
NEW_SCRIPTS=$(comm -13 <(echo "$INSTALLED_SCRIPTS_BEFORE") <(echo "$INSTALLED_SCRIPTS_AFTER") | grep -v "^$" || true)
REMOVED_SCRIPTS=$(comm -23 <(echo "$INSTALLED_SCRIPTS_BEFORE") <(echo "$INSTALLED_SCRIPTS_AFTER") | grep -v "^$" || true)

# Update convenience symlinks for new scripts
for script in $NEW_SCRIPTS; do
  symlink="/usr/local/bin/mc-${script}"
  source_file="$SCRIPT_DIR/${script}.sh"
  if [ -f "$source_file" ]; then
    ln -sf "$source_file" "$symlink"
    chmod +x "$source_file"
    info "Added shortcut: /usr/local/bin/mc-${script}"
  fi
done

# Remove broken symlinks for removed scripts
for script in $REMOVED_SCRIPTS; do
  symlink="/usr/local/bin/mc-${script}"
  if [ -L "$symlink" ]; then
    rm -f "$symlink"
    warn "Removed shortcut: /usr/local/bin/mc-${script} (script no longer exists)"
  fi
done

# ── .env.local sync (if .env changed) ───────────────────────
if echo "$CHANGED_FILES" | grep -q "^.env$"; then
  step "Syncing .env to .env.local ..."
  cp .env .env.local
fi

# ── Docker rebuild ──────────────────────────────────────────
CHANGED_DOCKER="no"
if echo "$CHANGED_FILES" | grep -qE "Dockerfile|docker-compose|scripts/bridge-logger|scripts/task-worker|scripts/gateway-sync|scripts/openclaw|scripts/db-init"; then
  CHANGED_DOCKER="yes"
fi

if [ "$CHANGED_DOCKER" = "yes" ] || [ "$NEED_NPM" = "yes" ]; then
  step "Rebuilding Docker images ..."
  docker compose build --pull bridge-logger task-worker gateway-sync 2>&1 | tail -3
fi

# ── Detect container changes (new/removed services) ──────────
SERVICES_BEFORE=$(docker compose ps --all --format json 2>/dev/null | jq -r '.Service' 2>/dev/null | sort | uniq || echo "")
docker compose up -d --build db-init
docker compose up -d --build bridge-logger task-worker gateway-sync
SERVICES_AFTER=$(docker compose ps --all --format json 2>/dev/null | jq -r '.Service' 2>/dev/null | sort | uniq || echo "")

# ── npm install (if package.json changed) ────────────────────
if [ "$NEED_NPM" = "yes" ]; then
  step "package.json changed — running npm install ..."
  npm install 2>&1 | tail -3
fi

# ── Create runtime dir if new ───────────────────────────────
if [ ! -d .runtime/bridge-logger ]; then
  mkdir -p .runtime/bridge-logger
  touch .runtime/bridge-logger/bridge-logger.lock
  chmod 666 .runtime/bridge-logger/bridge-logger.lock
  info "Created .runtime/bridge-logger/"
fi

# ── Verify services ─────────────────────────────────────────
sleep 3
echo ""
info "Service status:"
echo ""
printf "  %-20s %s\n" "db"              "$(docker compose ps db --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
printf "  %-20s %s\n" "db-init"         "$(docker compose ps db-init --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
printf "  %-20s %s\n" "bridge-logger"   "$(docker compose ps bridge-logger --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
printf "  %-20s %s\n" "task-worker"     "$(docker compose ps task-worker --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
printf "  %-20s %s\n" "gateway-sync"    "$(docker compose ps gateway-sync --format '{{.Status}}' 2>/dev/null || echo 'unknown')"
echo ""

if [ "$CHANGED_NM" = "yes" ]; then
  warn "Node modules may need reinstallation. Restart your Next.js dev server."
fi

info "Update complete."
echo ""
