# QA Checklist: NATIVE-GEMINI-ADAPTER-001 (v1.0)

Verification checks for the native Google Gemini provider adapter:

## Design Boundaries Check
- [x] No tool calling / function calling implemented.
- [x] No structured output / JSON schema support implemented.
- [x] No raw thinking or sensitive metadata leaked in logs or error bodies.

## Code Correctness Check
- [x] Native Gemini endpoints point to `POST /v1beta/models/{model}:generateContent` and `:streamGenerateContent`.
- [x] Auth header matches `x-goog-api-key: <api_key>`.
- [x] Chunked JSON array stream parsed correctly using stateful balanced-brace tokenizer.
- [x] `gemini-native` profile ID maps to native Gemini adapter.
- [x] Match arms for `ProviderKind::Gemini` are correctly placed in `api/capabilities.rs` and `api/model_runtime.rs`.

## Validation Check
- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check` passes cleanly.
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml` passes cleanly.
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml` passes all tests.
- [x] `npm run service:test` passes.
- [x] Playwright E2E tests for `gemini-native-compatibility.spec.ts` pass cleanly.
