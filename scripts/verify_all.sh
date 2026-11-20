#!/usr/bin/env bash
# Quality gate for Rosie: server compiles cleanly, web app parses.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> cargo check (server)"
(cd "$ROOT/server" && RUSTFLAGS="-D warnings" cargo check --quiet)

echo "==> node --check (web/app.js)"
node --check "$ROOT/web/app.js"

echo "All checks passed."
