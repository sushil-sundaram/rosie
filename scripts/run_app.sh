#!/usr/bin/env bash
set -e

if [ -d "$HOME/development/flutter/bin" ]; then
  export PATH="$HOME/development/flutter/bin:$PATH"
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting Rosie Rust server..."
(cd "$PROJECT_ROOT/server" && cargo run) &
SERVER_PID=$!

cleanup() {
  echo "Shutting down Rosie server (PID: $SERVER_PID)..."
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2

echo "Launching Rosie Flutter App..."
cd "$PROJECT_ROOT/mobile"
flutter run
