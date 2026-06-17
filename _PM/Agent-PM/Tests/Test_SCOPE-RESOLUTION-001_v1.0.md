# Test SCOPE-RESOLUTION-001 v1.0

## Rust Tests

- [x] Current conversation scope is emitted.
- [x] Weft origin scope is emitted as hidden/background when applicable.
- [x] Non-Weft Loom has no Weft origin scope.
- [x] Reserved scopes are emitted for ProjectGroup, ProjectAttachment, and ToolMcpContext.
- [x] Scoped retrieval descriptor contains active Loom allowlist.
- [x] Cross-conversation retrieval descriptor is lower priority.
- [x] Archived retrieval is disabled by default and lower priority when enabled.
- [x] Scope diagnostics contain counts/status only.
- [x] Diagnostics do not expose content, IDs, query text, raw thinking, or secrets.
- [x] Raw thinking markers are absent from Scope Resolution diagnostics.
- [x] `RetrievalQuery.loom_ids` filtering works for Tantivy.
- [x] `RetrievalQuery.loom_ids` filtering works for LanceDB.
- [x] Hybrid Retrieval passes `loom_ids` correctly.
- [x] Empty `loom_ids` preserves unfiltered behavior.

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

- Fresh debug service: PID `77627`, port `17652`, binary `services/loom-service/target/debug/loom-service`, fingerprint `sha256:7edef2a804ca8e60e49cd5a2dd68885acff32d79b3088bb7ba61473f3190444f`, inode `196667777`, temp DB/config under `/var/folders/.../loom-scope-resolution-runtime-QrZwDi/`, `/health` status `ready`, port released.
- Packaged sidecar: PID `78077`, port `17653`, binary `dist-electron/Loom.app/Contents/Resources/loom-service/loom-service`, fingerprint `sha256:294156eaed95ea10a470ee681bb364cd2bc6fcb054b7861da9ad32ef3ec27c98`, release fingerprint matched, temp DB/config under `/var/folders/.../loom-scope-resolution-packaged-zaB1di/`, `/health` status `ready`, port released.
