#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ARCH="${1:-native}"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Install Node.js LTS (includes npm) first." >&2; exit 1
fi
npm install
case "$ARCH" in
  native) npm run build:mac ;;
  x64) npm run build:mac:x64 ;;
  arm64) npm run build:mac:arm64 ;;
  *) echo "Usage: $0 [native|x64|arm64]" >&2; exit 2 ;;
esac
echo "Portable macOS ZIP is in release/ (extract PDF Studio.app and run it; no installer is used)."
