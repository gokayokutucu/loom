# QA CONTEXT-SNAPSHOT-MIGRATION-001 v1.0

## Architecture

- [x] SQLite remains the source of truth.
- [x] Snapshot rows store references, decisions, diagnostics, and budget metadata only.
- [x] Context Manager and Context Selection integrations remain deferred.
- [x] Agent Run linkage remains a documented future seam.

## Privacy

- [x] No full content or prompt text is persisted.
- [x] No provider payload or delta is persisted.
- [x] No raw thinking is persisted.
- [x] No secrets or credentials are persisted.
- [x] No vectors or raw tool output are persisted.

## Verification

- [x] Migration and repository tests pass.
- [x] Full Rust and frontend validation passes.
- [x] Fresh debug service is healthy.
- [x] Packaged sidecar is healthy and matches the release binary.
- [x] macOS packaged icon contract is preserved.
