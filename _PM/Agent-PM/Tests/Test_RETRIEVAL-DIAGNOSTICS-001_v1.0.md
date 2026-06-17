# Test RETRIEVAL-DIAGNOSTICS-001 v1.0

## Rust Tests

- [x] Healthy diagnostics report projection and index health.
- [x] Missing Tantivy index reports unavailable safely.
- [x] Missing LanceDB index reports unavailable safely.
- [x] Stale projection detects changed content.
- [x] Digest mismatch count is reported without digest values.
- [x] Tombstone count is reported without identifiers.
- [x] Corrupt index reports degraded safely.
- [x] Version mismatch reports degraded safely.
- [x] Hybrid Retrieval diagnostics summary remains safe.
- [x] Raw thinking is rejected before diagnostics.
- [x] Diagnostics do not include source identifiers.
- [x] Diagnostics do not include chunk refs.
- [x] Diagnostics do not include file system paths.
- [x] Diagnostics do not include raw error strings.

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
- [x] Packaged sidecar health/fingerprint verification.

## Runtime Evidence

- Fresh debug service: PID `87341`, port `17649`, binary `services/loom-service/target/debug/loom-service`, fingerprint `sha256:bf09c8cf57df7c1c4d88feec652357c7a885497b7d89df0557474062618ce31e`, temp DB/config under `/var/folders/.../loom-retrieval-diagnostics-runtime-DXxWg0/`, `/health` status `ready`, port released.
- Packaged sidecar: PID `89268`, port `17650`, binary `dist-electron/Loom.app/Contents/Resources/loom-service/loom-service`, fingerprint `sha256:f088054785d8a0e2bc92552e2438532f5c8fe0adfec1da89e147f45898040189`, release fingerprint matched, temp DB/config under `/var/folders/.../loom-retrieval-diagnostics-packaged-KU10yD/`, `/health` status `ready`, port released.
- Packaged app: PID `89995`, port `17651`, binary `dist-electron/Loom.app/Contents/MacOS/Electron`, sidecar `/health` status `ready`, port released.
