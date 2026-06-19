# Test MEMORY-WRITE-PIPELINE-EXPLICIT-001 v1.0

## Functional Tests

- [x] Explicit Memory save persists through SQLite.
- [x] User confirmation, extraction method, and confidence defaults are fixed.
- [x] `always_include` defaults false.
- [x] Explicit and profile Memories may set `always_include`.
- [x] Inferred Memory cannot set `always_include`.
- [x] Caller-provided topic key is stored unchanged.
- [x] Exact normalized duplicate reuses the active Memory in the same scope.
- [x] Explicit creation and duplicate events are appended.
- [x] Event payloads contain metadata only.
- [x] Existing Memory create/list/update behavior remains compatible.

## Privacy Tests

- [x] Raw-thinking markers are rejected.
- [x] Provider payload markers are rejected.
- [x] Authorization, credential, and secret markers are rejected.
- [x] Raw tool output markers are rejected.
- [x] Rejected values are absent from errors and events.
- [x] Rejection writes no Memory row.

## Validation

- [x] Rust format/check/tests: 932 passed.
- [x] npm service check/tests: 932 passed.
- [x] Production build and Vitest: 559 passed across 32 files.
- [x] `git diff --check`.
- [ ] `./loom.sh --publish --test`.
- [x] Electron dev package build and packaged/release static match.
- [ ] Live debug and packaged runtime verification.

## Runtime Evidence

Fresh debug and packaged binaries applied all migrations against isolated databases, but the execution environment denied loopback listener binding. `/health` and live explicit-save HTTP verification remain pending; focused API tests provide the current explicit-save proof.
