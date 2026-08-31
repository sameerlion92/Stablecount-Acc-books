#!/usr/bin/env bash
# Run on the personal server after git pull. Wipes all data (users, sessions, business records) and restarts the app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${STABLECOUNT_DATA_DIR:-/var/lib/stablecount}"
SERVICE="${STABLECOUNT_SERVICE:-stablecount-acc-books}"

cd "$ROOT"

echo "==> Pulling latest code..."
git pull origin main

echo "==> Installing dependencies..."
npm ci

echo "==> Building..."
npm run build

echo "==> Clearing all workspace data (users, sessions, business records)..."
CONFIRM=RESET STABLECOUNT_DATA_DIR="$DATA_DIR" bash "$ROOT/scripts/reset-workspace.sh"

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | rg -q "^${SERVICE}\\.service"; then
  echo "==> Restarting ${SERVICE}..."
  sudo systemctl restart "$SERVICE"
  sudo systemctl status "$SERVICE" --no-pager || true
else
  echo "==> Restart the app manually: STABLECOUNT_DATA_DIR=$DATA_DIR npm run start"
fi

echo ""
echo "Deploy complete. Open your APP_URL and create the Super Admin account."
