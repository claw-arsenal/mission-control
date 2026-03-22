#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required."
  exit 1
fi

if [ ! -f .env ]; then
  cat > .env <<'ENV'
OPENCLAW_GATEWAY_URL=http://127.0.0.1:8787
# OPENCLAW_GATEWAY_TOKEN=your-token-if-needed
ENV
fi

printf '%s\n' "Local dev: npm run dev:local"
printf '%s\n' "Docker stack: npm run dev:docker"
printf '%s\n' "DB only: npm run dev:db"

docker compose up -d --build
