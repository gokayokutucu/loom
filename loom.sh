#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

RUN_TEST=false
RUN_PUBLISH=false
RUN_E2E_THINKING=false
E2E_PORT=5189

usage() {
  cat <<'EOF'
Usage:
  ./loom.sh --test
  ./loom.sh --publish --test
  ./loom.sh --publish --test --e2e-thinking
  ./loom.sh --test --e2e-thinking --e2e-port 5191

Flags:
  --test           Run standard Loom validation.
  --publish        Build a fresh Rust service binary before validation.
  --e2e-thinking   Run the targeted ThinkingPanel product E2E.
  --e2e-port PORT  Set E2E_PORT for targeted E2E. Default: 5189.
  --help           Print this help text.

Notes:
  This script does not stage, commit, push, tag, merge, or release.
  Run it from the repository root after manually staging files as needed.
EOF
}

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --test)
      RUN_TEST=true
      shift
      ;;
    --publish)
      RUN_PUBLISH=true
      shift
      ;;
    --e2e-thinking)
      RUN_E2E_THINKING=true
      shift
      ;;
    --e2e-port)
      if [[ $# -lt 2 || "$2" == --* ]]; then
        echo "error: --e2e-port requires a port value" >&2
        exit 2
      fi
      E2E_PORT="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$RUN_TEST" != true && "$RUN_PUBLISH" != true && "$RUN_E2E_THINKING" != true ]]; then
  echo "error: no action selected" >&2
  usage >&2
  exit 1
fi

if [[ ! "$E2E_PORT" =~ ^[0-9]+$ ]]; then
  echo "error: --e2e-port must be numeric" >&2
  exit 2
fi

run_cmd() {
  local label="$1"
  shift
  local start end elapsed
  start="$(date +%s)"
  echo
  echo "==> $label"
  echo "+ $*"
  "$@"
  end="$(date +%s)"
  elapsed=$((end - start))
  echo "PASS: $label (${elapsed}s)"
}

if [[ "$RUN_PUBLISH" == true ]]; then
  run_cmd "Build fresh Rust service binary" \
    cargo build --manifest-path services/loom-service/Cargo.toml
fi

if [[ "$RUN_TEST" == true ]]; then
  run_cmd "Rust service format check" \
    cargo fmt --manifest-path services/loom-service/Cargo.toml --check
  run_cmd "Rust service check" \
    cargo check --manifest-path services/loom-service/Cargo.toml
  run_cmd "Rust service tests" \
    cargo test --manifest-path services/loom-service/Cargo.toml
  run_cmd "Service check script" \
    npm run service:check
  run_cmd "Service test script" \
    npm run service:test
  run_cmd "Frontend build" \
    npm run build
  run_cmd "Vitest suite" \
    npx vitest run
  run_cmd "Staged diff whitespace check" \
    git diff --cached --check
fi

if [[ "$RUN_E2E_THINKING" == true ]]; then
  run_cmd "ThinkingPanel product E2E on port ${E2E_PORT}" \
    env E2E_PORT="$E2E_PORT" npx playwright test e2e/thinking-panel.spec.ts
fi

echo
echo "All selected Loom validation steps passed."
