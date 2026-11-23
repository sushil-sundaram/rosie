#!/usr/bin/env bash
# Quality gate for Rosie: server compiles cleanly and its tests pass; web app parses.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> cargo check (server)"
(cd "$ROOT/server" && RUSTFLAGS="-D warnings" cargo check --quiet)

echo "==> cargo test (server)"
(cd "$ROOT/server" && cargo test --quiet)

echo "==> node --check (web)"
node --check "$ROOT/web/app.js"
node --check "$ROOT/web/theme.js"

echo "All checks passed."
