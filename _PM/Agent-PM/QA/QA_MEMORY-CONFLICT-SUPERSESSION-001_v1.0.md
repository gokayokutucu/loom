# QA MEMORY-CONFLICT-SUPERSESSION-001 v1.0

## Architecture

- [x] SQLite remains the source of truth.
- [x] Dedupe, conflict lookup, insert, tombstone, and events share one transaction.
- [x] Conflict identity is exactly topic key plus Loom scope.
- [x] Only active Memories participate in conflict lookup.
- [x] Historical rows and Context Snapshot references remain immutable.
- [x] No schema migration or projection invalidation is introduced.
- [x] No read-policy masking, semantic dedupe, automatic topic generation, or background extraction is introduced.

## Privacy

- [x] Lifecycle events contain operation metadata only.
- [x] No content, prompt, provider payload, raw thinking, or sensitive value enters events.
- [x] PM documentation contains no runtime-local identifiers or sensitive values.

## Verification

- [x] Compile, unit, frontend, static package, icon, and binary-match validation passes.
- [ ] Fresh debug API supersession flow passes.
- [ ] Packaged sidecar supersession flow passes.

## QA Result

Partial. Automated and static package validation passes; live loopback runtime evidence remains blocked by environment permission, so commit completion is deferred.
