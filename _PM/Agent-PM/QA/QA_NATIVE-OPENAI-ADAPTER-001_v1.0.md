# QA Checklist: NATIVE-OPENAI-ADAPTER-001 (v1.0)

Verification checks for the native OpenAI provider adapter:

## Design Boundaries Check
- [x] No tool calling implemented.
- [x] No structured output / JSON schema support implemented in the new adapter.
- [x] No raw thinking or sensitive metadata leaked in logs or error bodies.

## Code Correctness Check
- [x] Native OpenAI endpoint points to `POST /v1/chat/completions`.
- [x] Auth header matches standard `Authorization: Bearer <api_key>`.
- [x] SSE chunks parsed correctly for both data objects and `data: [DONE]`.
- [x] `openai-native` profile ID maps to native OpenAI adapter.
- [x] Match arms for `ProviderKind::OpenAi` are correctly placed in `api/capabilities.rs` and `api/model_runtime.rs`.

## Validation Check
- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check` passes cleanly.
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml` passes cleanly.
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml` passes all tests.
- [x] `npm run service:test` passes.
