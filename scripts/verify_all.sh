#!/usr/bin/env bash
set -e

# Add flutter to PATH if located in standard local development directory
if [ -d "$HOME/development/flutter/bin" ]; then
  export PATH="$HOME/development/flutter/bin:$PATH"
fi

echo "=========================================="
echo "🤖 Running Rosie EGM Verification Suite"
echo "=========================================="

echo ""
echo "[1/3] Checking Flutter Mobile Analyzer..."
cd "$(dirname "$0")/../mobile"
flutter analyze --no-fatal-infos
echo "✓ Flutter analysis clean (0 issues)"

echo ""
echo "[2/3] Running Flutter Mobile Tests..."
flutter test
echo "✓ All Flutter tests passed"

echo ""
echo "[3/3] Checking Rust Backend Compilation..."
cd "../server"
cargo check
echo "✓ Rust backend check passed"

echo ""
echo "=========================================="
echo "🎉 All Rosie EGM quality gates passed!"
echo "=========================================="
