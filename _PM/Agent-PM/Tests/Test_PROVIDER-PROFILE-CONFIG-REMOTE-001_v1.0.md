# PROVIDER-PROFILE-CONFIG-REMOTE-001 Test Plan

## Rust Config Tests

- [x] TOML round-trip preserves remote provider profile fields.
- [x] TOML round-trip preserves `secretRef` and does not store raw secrets.
- [x] Invalid `secretRef` is rejected.
- [x] Raw secret-looking config metadata values are rejected.
- [x] Disabled NVIDIA OpenAI-compatible example validates.
- [x] Enabled remote profile with missing env secret value does not fail config validation.
- [x] OpenAI-compatible runtime reports missing secret safely.
- [x] Rig transport is unavailable without `experimental-rig` and valid with the feature.
- [x] Existing Ollama config tests still pass.

## Validation

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml --features experimental-rig`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `git diff --check`
