#!/usr/bin/env bash
# tools/litellm-sandbox/scripts/smoke.sh
#
# Minimal smoke test for the LiteLLM sandbox.
# Sends one non-streaming request to the proxy and checks for a valid response.
#
# Usage:
#   ./scripts/smoke.sh                        # default: gpt-4o-mini, localhost:4000
#   MODEL=claude-3-haiku ./scripts/smoke.sh   # pick a different alias
#   LITELLM_BASE=http://localhost:4000 MODEL=gemini-2.0-flash ./scripts/smoke.sh
#
# Requirements: curl, jq (optional — output is shown either way)

set -euo pipefail

LITELLM_BASE="${LITELLM_BASE:-http://127.0.0.1:4000}"
MODEL="${MODEL:-gpt-4o-mini}"

# Read master key from .env if it exists; otherwise use the example default.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
MASTER_KEY="loom-sandbox-key-change-me"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  MASTER_KEY="$(grep -E '^LITELLM_MASTER_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" || echo "$MASTER_KEY")"
fi

echo "==> LiteLLM sandbox smoke test"
echo "    Base URL : $LITELLM_BASE"
echo "    Model    : $MODEL"
echo ""

PAYLOAD=$(
  cat <<EOF
{
  "model": "$MODEL",
  "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
  "max_tokens": 16,
  "stream": false
}
EOF
)

RESPONSE=$(
  curl --silent --fail-with-body \
    --max-time 30 \
    -X POST "$LITELLM_BASE/v1/chat/completions" \
    -H "Authorization: Bearer $MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD"
)

echo "==> Raw response:"
echo "$RESPONSE" | (jq . 2>/dev/null || echo "$RESPONSE")
echo ""

# Quick sanity check: the response must contain "choices".
if echo "$RESPONSE" | grep -q '"choices"'; then
  echo "PASS: received a valid chat completion response."
else
  echo "FAIL: response did not contain 'choices'." >&2
  exit 1
fi
