# Test ELECTRON-PROVIDER-SELECTION-SMOKE-001 v1.0

## Test Plan

- [x] Branch and upstream checks pass.
- [x] LiteLLM sandbox liveliness returns `"I'm alive!"`.
- [x] Electron runtime health reports `runtimeOwnerKind=electron`.
- [x] `runtime/providers` lists `ollama-local` and `litellm-sandbox`.
- [x] Model picker shows `Ollama Local` group.
- [x] Model picker shows `LiteLLM Sandbox` group and sandbox badge.
- [x] Ollama/local prompt `Say hello in exactly two words` completes with visible answer.
- [x] LiteLLM Sandbox prompt `Say hello in exactly two words` completes with visible answer.
- [x] LiteLLM logs include `POST /v1/chat/completions HTTP/1.1" 200 OK`.
- [x] Close/reopen picker preserves checked `ollama-qwen`.
- [x] Renderer reload exposed failed restore before fix.
- [x] Renderer reload preserves `litellm-sandbox · ollama-qwen` after fix.
- [x] Unit test covers remote Main selection surviving settings reconciliation.
- [x] `npm run test:unit` result recorded.
- [x] `npm run build` result recorded.
- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check` result recorded.
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml` result recorded.
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml` result recorded.
- [x] `git diff --check` result recorded.

## Validation Results

- `npm run test:unit`: passed, 30 files / 543 tests.
- `npm run build`: passed.
- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`: failed on pre-existing formatting drift in `services/loom-service/src/api/orchestration.rs`.
- `cargo check --manifest-path services/loom-service/Cargo.toml`: passed.
- `cargo test --manifest-path services/loom-service/Cargo.toml`: passed, 711 tests.
- `git diff --check`: passed.

## Data Authority

This smoke used the Electron-owned `loom-service` dev runtime and service-created Loom/Response records. It did not use TypeScript-local fallback.
