#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDFILE="$ROOT/router/litellm.pid"
if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null && echo "Stopped router (pid $(cat "$PIDFILE"))" || echo "Router not running"
  rm -f "$PIDFILE"
else
  echo "No pidfile — router was not started with --bg"
fi
