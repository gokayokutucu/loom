# Test SQLITE-PROJECTION-CONTRACTS-001 v1.0

## Rust Tests

- [x] Stable source identity is deterministic.
- [x] Stable `chunk_ref` values are deterministic.
- [x] Projection enumeration order is deterministic.
- [x] `content_digest` changes when source content changes.
- [x] Full rebuild planning detects new chunks.
- [x] Full rebuild planning detects unchanged chunks.
- [x] Full rebuild planning tombstones deleted chunks.
- [x] Response projection eligibility is covered.
- [x] Reference projection eligibility is covered.
- [x] Attachment chunk projection eligibility is covered.
- [x] Memory projection eligibility is covered.
- [x] Response capsule projection eligibility is covered.
- [x] Loom checkpoint projection eligibility is covered.
- [x] Agent run/event audit records are excluded.
- [x] Raw thinking marker payloads are rejected.
- [x] No LanceDB/Tantivy/embedding dependencies are introduced.

## Validation Commands

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `./loom.sh --publish --test`
- [x] `npm run electron:package:dev`
