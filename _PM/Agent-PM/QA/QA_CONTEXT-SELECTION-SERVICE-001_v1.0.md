# QA CONTEXT-SELECTION-SERVICE-001 v1.0

## Architecture

- [x] Scope Resolution remains scope authority.
- [x] Hybrid Retrieval remains relevance authority.
- [x] Context Selection owns tier assignment and within-tier ordering only.
- [x] Context Manager integration remains deferred.
- [x] SQLite remains source of truth.

## Privacy

- [x] No prompt or full content appears in ContextPayload.
- [x] No raw thinking appears in payload, diagnostics, or snapshots.
- [x] No provider payload/delta/envelope appears.
- [x] No secrets, credentials, vectors, or raw tool output appears.
- [x] Diagnostics contain no raw identifiers or content.

## Verification

- [x] Focused and full test suites pass.
- [x] Fresh debug service is healthy.
- [x] Packaged sidecar is healthy and matches release binary.
- [x] macOS icon packaging contract remains valid.

Packaged binary fingerprint verified. Packaged sidecar health smoke passed: `/health` returned `status: ready`, `lifecycleState: ready`, `database.status: ready`, `buildProfile: release`; binary fingerprint reported matches computed hash; process stopped, port released.
