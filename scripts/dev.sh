#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the local database."
  exit 1
fi

if [ ! -f .env.local ]; then
  cat > .env.local <<'ENV'
DATABASE_URL=postgresql://openclaw:openclaw@localhost:5432/mission_control
OPENCLAW_DATABASE_URL=postgresql://openclaw:openclaw@localhost:5432/mission_control
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
ENV
fi

docker compose -f docker-compose.dev.yml up -d
npm run dev:local
