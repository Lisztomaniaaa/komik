#!/usr/bin/env bash
# Start the Anthropic <-> Pareto bridge on http://127.0.0.1:4000
#
#   ./router/start-router.sh          # foreground
#   ./router/start-router.sh --bg     # background, logs to router/litellm.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/router/.venv"
PORT="${ROUTER_PORT:-4000}"

if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi

: "${PARETO_API_KEY:?PARETO_API_KEY is not set — copy .env.example to .env and fill it in}"
: "${PARETO_BASE_URL:=https://api.paretoinference.com/v1}"
: "${LITELLM_MASTER_KEY:=sk-local-dev}"
export PARETO_API_KEY PARETO_BASE_URL LITELLM_MASTER_KEY

if [ ! -x "$VENV/bin/litellm" ]; then
  echo "Installing LiteLLM into $VENV ..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" -q install --upgrade pip
  "$VENV/bin/pip" -q install 'litellm[proxy]'
fi

CMD=("$VENV/bin/litellm" --config "$ROOT/router/litellm.config.yaml" --host 127.0.0.1 --port "$PORT")

if [ "${1:-}" = "--bg" ]; then
  nohup "${CMD[@]}" > "$ROOT/router/litellm.log" 2>&1 &
  echo $! > "$ROOT/router/litellm.pid"
  for _ in $(seq 1 30); do
    if curl -fsS -m 2 --noproxy '*' "http://127.0.0.1:$PORT/health/liveliness" >/dev/null 2>&1; then
      echo "Router up on http://127.0.0.1:$PORT (pid $(cat "$ROOT/router/litellm.pid"))"
      exit 0
    fi
    sleep 2
  done
  echo "Router failed to start — see router/litellm.log" >&2
  exit 1
fi

exec "${CMD[@]}"
