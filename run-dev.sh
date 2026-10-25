#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required." >&2; exit 2; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm is required." >&2; exit 2; }
if [[ ! -d node_modules ]]; then npm install; fi
npm run dev
