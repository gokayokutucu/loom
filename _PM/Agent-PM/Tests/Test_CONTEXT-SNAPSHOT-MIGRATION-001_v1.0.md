# Test CONTEXT-SNAPSHOT-MIGRATION-001 v1.0

## Migration And Functional Tests

- [x] Migration creates snapshot and candidate tables.
- [x] Snapshot can be created and loaded.
- [x] Snapshot with candidates is created transactionally.
- [x] Candidates are listed by deterministic final rank.
- [x] Rejected candidate reason persists.
- [x] Selected and rejected counts round-trip.
- [x] Budget JSON round-trips.
- [x] Diagnostics JSON round-trips.
- [x] Source identity fields round-trip.
- [x] Replay metadata requires no full content.
- [x] Hidden-background and mandatory flags persist.

## Privacy Tests

- [x] Schema has no raw-thinking columns.
- [x] Candidate metadata rejects raw-thinking markers.
- [x] JSON fields reject secret and credential markers.
- [x] Candidate metadata rejects content, prompt, provider payload, vectors, and raw tool output.
- [x] Budget and diagnostics JSON accept safe metadata only.

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
- [x] Fresh runtime `/health` verification.
- [x] Packaged sidecar health and fingerprint verification.
