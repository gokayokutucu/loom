# Test CONTEXT-SNAPSHOT-LINKING-001 v1.0

## Repository Tests

- [x] Existing snapshot links to existing Agent Run.
- [x] Linking the same snapshot twice is idempotent.
- [x] Unknown Agent Run returns a clear error.
- [x] Unknown Context Snapshot returns a clear error.
- [x] Snapshot owned by another run is rejected.
- [x] A different existing snapshot link is not replaced.
- [x] Agent Run status remains unchanged.
- [x] `context_snapshot_id` reads back through `get_run`.

## Privacy And Boundary Tests

- [x] Linking writes only `context_snapshot_id`.
- [x] No prompt, content, provider payload, or raw thinking is persisted.
- [x] Main generation and Quick Ask remain untouched.
- [x] Context Manager remains unwired.

## Validation Commands

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `git diff --check`
- [x] `./loom.sh --publish --test`
- [x] `npm run electron:package:dev`
- [x] Fresh debug service health verification.
- [x] Packaged sidecar health and fingerprint verification.

## Validation Evidence

- `./loom.sh --publish --test` passed successfully.
- Fresh debug service health and fingerprint verified successfully.
- Packaged sidecar health and fingerprint verified successfully.
