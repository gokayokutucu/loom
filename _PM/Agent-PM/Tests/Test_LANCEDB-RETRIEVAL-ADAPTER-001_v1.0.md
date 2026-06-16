# Test LANCEDB-RETRIEVAL-ADAPTER-001 v1.0

## Rust Tests

- [x] Deterministic fake embedding provider produces stable vectors.
- [x] LanceDB index initialization creates an empty projection table and diagnostics.
- [x] Full rebuild indexes all eligible SQLite projection candidates.
- [x] Rebuild from empty is reproducible.
- [x] Incremental upsert replaces changed vectors.
- [x] Tombstone/delete handling removes stale vectors.
- [x] Vector similarity search preserves canonical chunk identity.
- [x] Source filtering limits semantic candidates.
- [x] Embedding provider/model/dimension metadata is preserved.
- [x] Raw thinking markers are rejected before embedding.
- [x] Agent event audit data is not a projection source.
- [x] No Ollama-only embedding dependency is introduced.

## Validation Commands

- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml retrieval::lancedb_adapter -- --nocapture`
- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `git diff --check`
- [x] `./loom.sh --publish --test`
- [x] `npm run electron:package:dev`

## Packaged Runtime Note

- [x] Packaged `loom-service` sidecar is byte-for-byte identical to the release binary.
- [x] Packaged macOS icon rules pass.
- [x] Packaged sidecar launch health smoke passed on `127.0.0.1:17645` with PID `64854`.
- [x] Packaged sidecar `/health` reported `status=ready`, `runtime=loom-service`, and fingerprint `sha256:31cabb322a0023f93962798a8810e0feaa6467c0b9315595caa6db325fcf0949`.
- [x] Packaged sidecar `runtime_binary_mismatch=false`.
- [x] Packaged sidecar used temp config `/var/folders/dj/hq4144vd0ysfw7xzq45jtms00000gn/T/loom-packaged-sidecar-smoke-CVVPqW/loom-service.toml` and temp DB `/var/folders/dj/hq4144vd0ysfw7xzq45jtms00000gn/T/loom-packaged-sidecar-smoke-CVVPqW/loom.db`.
- [x] Packaged sidecar stopped with `SIGTERM`; port `17645` was released.
