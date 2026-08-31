#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${STABLECOUNT_DATA_DIR:-/var/lib/stablecount}"

echo "Stablecount Acc-books — self-host setup"
echo "Data directory: $DATA_DIR"

mkdir -p "$DATA_DIR/uploads"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "Created .env from .env.example — edit APP_URL, SMTP, and STABLECOUNT_DATA_DIR before starting."
fi

cd "$ROOT"
npm ci
npm run build

echo ""
echo "Setup complete. Start with:"
echo "  STABLECOUNT_DATA_DIR=$DATA_DIR npm run start"
echo ""
echo "Or with Docker:"
echo "  docker compose up -d --build"
