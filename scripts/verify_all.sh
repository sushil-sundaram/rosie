#!/usr/bin/env bash
# Quality gate for Rosie: server compiles cleanly and its tests pass; web app parses.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> cargo check & build (server)"
(cd "$ROOT/server" && RUSTFLAGS="-D warnings" cargo check --quiet && cargo build --quiet)

echo "==> cargo test (server)"
(cd "$ROOT/server" && cargo test --quiet)

echo "==> node --check (web)"
node --check "$ROOT/web/theme.js"
node --check "$ROOT/web/sw.js"
node --check "$ROOT/scripts/e2e_smoke.mjs"
while IFS= read -r -d '' f; do
  node --input-type=module --check < "$f"
done < <(find "$ROOT/web" -name '*.js' ! -path "$ROOT/web/theme.js" ! -path "$ROOT/web/sw.js" -print0)

echo "==> e2e responsive smoke (390x844 mobile & 1280x800 desktop)"
node "$ROOT/scripts/e2e_smoke.mjs"

echo "All checks passed."
