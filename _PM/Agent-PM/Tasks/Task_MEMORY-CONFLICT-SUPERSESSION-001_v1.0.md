# Task MEMORY-CONFLICT-SUPERSESSION-001 v1.0

## Goal

Implement deterministic topic-key conflict and supersession for new explicit Memory records.

## Checklist

- [x] Confirm clean branch and prerequisite Memory commits.
- [x] Validate caller-provided topic keys without normalization.
- [x] Preserve exact-text deduplication as the first write decision.
- [x] Resolve conflicts by `(topic_key, source_loom_id)` without `memory_type`.
- [x] Keep global and Loom-scoped conflict domains separate.
- [x] Insert the successor with `supersedes_id` pointing to the active predecessor.
- [x] Soft-delete the predecessor atomically.
- [x] Append metadata-only `superseded` lifecycle evidence.
- [x] Preserve predecessor rows, events, and Context Snapshot references.
- [x] Do not inherit `always_include` unless the caller explicitly requests it.
- [x] Allow forgotten topic-key slots to be reused.
- [x] Keep Context Manager, Retrieval, Scope Resolution, Main, and Quick Ask untouched.
- [x] Complete full validation and live runtime verification.
- [x] Commit with `feat: add memory conflict supersession`.

## Boundaries

Supersession applies only when POST creates a new explicit/profile Memory with a caller-provided topic key. PATCH validates topic-key syntax but mutates the same record and does not create a supersession link. Automatic topic generation, semantic conflict detection, inferred writes, read-time masking, tags, and projection invalidation remain deferred.

System-note participation is rejected by repository policy in v1. The explicit API does not accept system-note or inferred Memory creation.
