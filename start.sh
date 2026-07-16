#!/usr/bin/env bash
# Start the MindForge backend (which also serves the frontend).
# Usage: ./start.sh [port]   (default port: 8001)

set -e

PORT=${1:-8001}
ENV_FILE="$(dirname "$0")/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "Warning: .env not found. Copy .env.example to .env and fill in your keys."
fi

if [ -z "$GEMINI_API_KEY" ]; then
  echo "Error: GEMINI_API_KEY is not set. Add it to .env or export it before running."
  exit 1
fi

# Rebuild JS bundle so it stays in sync with source files
FRONTEND="$(dirname "$0")/frontend/js"
cat "$FRONTEND/api.js" "$FRONTEND/katex-render.js" "$FRONTEND/math-keyboard.js" > "$FRONTEND/bundle.js"
echo "JS bundle rebuilt."

cd "$(dirname "$0")/backend"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
