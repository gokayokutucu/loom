# PROVIDER-HEALTH-DISCOVERY-PROFILES-001 Test Plan

## Service Tests

- [x] Disabled NVIDIA profile reports `disabled`.
- [x] Missing NVIDIA secret reports `missing_secret`.
- [x] Saved secret status does not leak raw secret values.
- [x] Invalid profile reports `invalid_config`.
- [x] Rig transport reports `feature_gated` when the feature is not enabled.
- [x] Ollama local profile remains represented through existing runtime health.

## Frontend Tests

- [x] Rust HTTP client maps `/runtime/providers` profile statuses.
- [x] Existing provider profile helper tests still pass.

## Validation

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml api::model_runtime::tests`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] Browser smoke for Settings provider runtime status
- [x] `git diff --check`
