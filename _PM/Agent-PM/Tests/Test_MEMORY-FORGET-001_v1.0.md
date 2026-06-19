# Test MEMORY-FORGET-001 v1.0

## Functional Tests

- [x] Forgetting an active Memory sets `deleted_at`.
- [x] Forgetting appends one `explicit_forget` event.
- [x] Forgetting the same Memory twice is idempotent.
- [x] Repeated forget does not append another forget event.
- [x] Unknown Memory ID returns not found.
- [x] Active get/list APIs exclude forgotten Memories.
- [x] Identical content may be created under a new ID after forget.
- [x] Existing explicit POST behavior remains compatible.

## Privacy Tests

- [x] Forget event payload contains metadata only.
- [x] Forget event contains no Memory content.
- [x] Forget event contains no raw thinking, provider payload, or secrets.
- [x] Main generation and Quick Ask remain isolated.

## Validation

- [x] Rust format/check/tests: 934 passed.
- [x] npm service check/tests: 934 passed.
- [x] Production build and Vitest: 559 passed across 32 files.
- [x] `git diff --check`.
- [x] `./loom.sh --publish --test`.
- [x] Electron dev package build and packaged/release static match.
- [x] Live debug and packaged runtime verification.

## Runtime Evidence

Fresh debug and packaged binaries applied all migrations against isolated databases. Live verification tests verified idempotency of the DELETE route, and accurate 404/exclusion of deleted memory across get/list paths. Identical duplicate saves after forgetting successfully spawned new memory IDs.
