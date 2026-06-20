# Task MEMORY-PROJECTION-INVALIDATION-001 v1.0

## Goal

Add durable SQLite-owned retrieval projection invalidation metadata for Memory lifecycle changes without rebuilding Tantivy or LanceDB in the write request.

## Checklist

- [x] Confirm branch and Memory Read Policy prerequisite.
- [x] Add `current`, `stale`, and `tombstoned` projection invalidation states.
- [x] Add privacy-safe invalidation timestamps.
- [x] Preserve deterministic `memory:{memory_id}:content` chunk identity.
- [x] Mark explicit Memory creation stale in the Memory transaction.
- [x] Mark forgotten Memory projection metadata tombstoned in the forget transaction.
- [x] Mark superseded predecessor tombstoned and successor stale atomically.
- [x] Keep duplicate saves free of additional invalidation.
- [x] Keep `always_include`-only PATCH updates free of reindex work.
- [x] Make the shared projection rebuild plan recognize stale chunks.
- [x] Keep Tantivy/LanceDB rebuild execution outside Memory requests.
- [x] Keep Retrieval ranking, Context Selection, Context Manager, Main, and Quick Ask unchanged.
- [ ] Complete full validation and live runtime verification.
- [ ] Commit with `feat: invalidate memory retrieval projections`.

## Invalidation Model

New Memory projection rows contain only identity, scope, lifecycle state, timestamps, and a non-content placeholder digest. A later shared projection plan resolves canonical content from SQLite, refreshes digests/metadata, and returns state to `current`. Tombstones remain visible to both incremental adapters for index deletion.
