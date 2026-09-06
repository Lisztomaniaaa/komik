# Point Claude Code at the local bridge instead of api.anthropic.com.
#
#   source router/claude-env.sh
#   claude
#
# Undo by opening a new shell.

_ROUTER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$_ROUTER_ROOT/.env" ] && { set -a; . "$_ROUTER_ROOT/.env"; set +a; }

export ANTHROPIC_BASE_URL="http://127.0.0.1:${ROUTER_PORT:-4000}"
export ANTHROPIC_AUTH_TOKEN="${LITELLM_MASTER_KEY:-sk-local-dev}"
unset ANTHROPIC_API_KEY

# Model names as declared in router/litellm.config.yaml
export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-glm-5.3}"
export ANTHROPIC_SMALL_FAST_MODEL="glm-5.3-flash"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="glm-5.3-flash"

# These models are not in Claude Code's catalog; declare the real context window
# so auto-compact does not assume 200k. .claude/settings.json maps their
# client-side behaviour via modelPicker/behavesAs.
export CLAUDE_CODE_MAX_CONTEXT_TOKENS="${CLAUDE_CODE_MAX_CONTEXT_TOKENS:-128000}"

# Keep localhost off the outbound proxy.
export NO_PROXY="${NO_PROXY:+$NO_PROXY,}127.0.0.1,localhost"
export no_proxy="$NO_PROXY"

unset _ROUTER_ROOT
echo "Claude Code -> $ANTHROPIC_BASE_URL (model: $ANTHROPIC_MODEL)"
