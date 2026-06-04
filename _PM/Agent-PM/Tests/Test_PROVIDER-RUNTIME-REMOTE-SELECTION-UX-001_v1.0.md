# PROVIDER-RUNTIME-REMOTE-SELECTION-UX-001 Test Plan

## Unit

- [x] Provider helper blocks remote Main selection without privacy acknowledgement.
- [x] Provider helper blocks remote Main selection without saved secret.
- [x] Provider helper blocks invalid or feature-gated runtime statuses.
- [x] Engine client hydrates provider-aware Main assignment fields.
- [x] Service config rejects selected disabled profiles.
- [x] Service config rejects selected profile without model.

## Integration / Product

- [x] Settings displays remote profile without making it default automatically.
- [x] Remote profile can be explicitly selected for Main after gate requirements.
- [x] Main generation uses selected remote profile/model.
- [x] Quick Ask remains unchanged/local.
- [x] Raw API keys do not appear in config, logs, UI, or tests.

## Validation

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `git diff --check`
