# Task MEMORY-FORGET-001 v1.0

## Goal

Implement explicit, idempotent Memory forget semantics through the existing DELETE endpoint.

## Checklist

- [x] Confirm clean branch and explicit write-pipeline prerequisite.
- [x] Reuse `DELETE /memory/:memory_id`.
- [x] Soft-delete active Memory rows without removing history.
- [x] Append one metadata-only `explicit_forget` event transactionally.
- [x] Make repeated forget idempotent without duplicate events.
- [x] Return not found only when the Memory ID never existed.
- [x] Keep active get/list paths filtered by `deleted_at`.
- [x] Allow identical explicit content to be recreated after forget.
- [x] Keep Context Snapshots, Retrieval indexes, Main, and Quick Ask untouched.
- [x] Complete full validation and runtime verification.
- [x] Commit with `feat: add explicit memory forget`.

## Duplicate After Forget

Exact deduplication considers active rows only. An explicit save after forgetting identical content creates a new Memory ID and preserves the tombstoned row and its events.
