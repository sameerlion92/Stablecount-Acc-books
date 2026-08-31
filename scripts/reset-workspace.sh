#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${STABLECOUNT_DATA_DIR:-}"

if [ -z "$DATA_DIR" ]; then
  if [ -d "$ROOT/data" ]; then
    DATA_DIR="$ROOT/data"
  else
    DATA_DIR="$ROOT"
  fi
fi

echo "This removes all workspace data: database, uploads, and local dev files."
echo "Target: $DATA_DIR"
echo ""

if [ "${CONFIRM:-}" = "RESET" ]; then
  confirm="RESET"
else
  read -r -p "Type RESET to continue: " confirm
fi
if [ "$confirm" != "RESET" ]; then
  echo "Cancelled."
  exit 1
fi

rm -f "$ROOT/stablecount.db" "$ROOT/stablecount.db-shm" "$ROOT/stablecount.db-wal"
rm -rf "$ROOT/.uploads"
rm -f "$DATA_DIR/stablecount.db" "$DATA_DIR/stablecount.db-shm" "$DATA_DIR/stablecount.db-wal"
rm -rf "$DATA_DIR/uploads"
if [ "$DATA_DIR" != "$ROOT" ]; then
  rmdir "$DATA_DIR" 2>/dev/null || true
fi
rm -rf "$ROOT/data"

echo "Workspace data cleared. Restart the app and create your Super Admin account to begin fresh."
