# Task MEMORY-WRITE-PIPELINE-EXPLICIT-001 v1.0

## Goal

Implement synchronous, explicit-only Memory persistence through the existing Memory API and SQLite repository.

## Checklist

- [x] Confirm schema foundation and write-pipeline design commits.
- [x] Reuse `POST /memory` as the explicit-save entry point.
- [x] Apply explicit Memory defaults deterministically.
- [x] Enforce input, normalized, and pre-persistence sanitization.
- [x] Add exact normalized-text dedupe within Memory type and Loom scope.
- [x] Append metadata-only `explicit_created` and `duplicate_skipped` events.
- [x] Support caller-provided `topic_key` and explicit `always_include` storage.
- [x] Keep Context Manager, Retrieval, Scope Resolution, Main, and Quick Ask unchanged.
- [ ] Complete full validation and runtime verification.
- [ ] Commit with `feat: add explicit memory write pipeline`.

## Deferred

Topic conflict and supersession behavior is intentionally deferred to `MEMORY-CONFLICT-SUPERSESSION-DESIGN-001`. Bear-like tag/topic behavior will be explored later. No topic key is generated automatically.

Sanitization rejection does not append an event because `memory_events.memory_id` requires an existing Memory. Rejected new inputs therefore remain strict zero-write operations with a safe API error.
