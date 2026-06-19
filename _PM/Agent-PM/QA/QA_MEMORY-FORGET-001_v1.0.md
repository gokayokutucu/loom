# QA MEMORY-FORGET-001 v1.0

## Architecture

- [x] SQLite remains the canonical Memory source.
- [x] Forget is a soft delete, never a hard delete.
- [x] Tombstone and lifecycle event are one transaction.
- [x] Memory events and Context Snapshot references are preserved.
- [x] Retrieval projection invalidation remains deferred.
- [x] Conflict, supersession, read policy, and autonomous behavior are unchanged.

## Privacy

- [x] Event payload uses only safe identifiers and operation metadata.
- [x] No content, prompt, provider payload, raw thinking, or secret is persisted in events.
- [x] PM documentation contains no runtime-local identifiers or credentials.

## Verification

- [x] Full validation passes.
- [x] Fresh debug create/forget verification passes.
- [x] Packaged sidecar create/forget verification passes.

## QA Result

Pass. Repository/API, privacy, regression, migration-startup, packaging checks, and live create/forget verification pass.
