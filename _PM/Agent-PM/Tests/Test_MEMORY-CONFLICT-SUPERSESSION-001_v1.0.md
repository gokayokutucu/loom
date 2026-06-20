# Test MEMORY-CONFLICT-SUPERSESSION-001 v1.0

## Functional Tests

- [x] Lowercase dot-separated topic keys with digits and underscores are accepted.
- [x] Empty, uppercase, spaced, slashed, leading-dot, trailing-dot, and repeated-dot keys are rejected.
- [x] Exact normalized duplicate detection runs before topic conflict handling.
- [x] Same topic key and same scope supersedes the active Memory.
- [x] Memory type is not part of the conflict key.
- [x] Different Loom scopes do not conflict.
- [x] Global and Loom-scoped Memories do not conflict.
- [x] Successor `supersedes_id` points to the predecessor.
- [x] Predecessor is soft-deleted and excluded from active list/get paths.
- [x] Successor remains active.
- [x] Context Snapshot source references remain unchanged.
- [x] `always_include` is not inherited implicitly.
- [x] Forgotten topic-key slots can be reused without supersession.
- [x] Repository priority policy rejects inferred or system overrides of explicit/profile Memory.
- [x] Existing explicit save, duplicate, forget, and always-include tests remain present.

## Privacy Tests

- [x] Supersession event payload contains metadata only.
- [x] Event payload contains no predecessor or successor content.
- [x] Event payload contains no raw thinking, provider payload, or sensitive value.
- [x] Main generation and Quick Ask remain isolated.

## Validation

- [x] Rust format/check/tests: 943 passed.
- [x] npm service check/tests: 943 passed with loopback test permission.
- [x] Production build and Vitest: 559 passed across 32 files.
- [x] `git diff --check`.
- [ ] `./loom.sh --publish --test`.
- [x] Electron dev package, icon authority, and packaged/release byte match.
- [ ] Live debug and packaged supersession verification.

## Environment Blocker

Live debug and packaged sidecar startup require loopback bind permission. The permission requests were not granted during this run, so health/API runtime proof and the standard publish script remain incomplete. No commit is permitted until those gates pass.
