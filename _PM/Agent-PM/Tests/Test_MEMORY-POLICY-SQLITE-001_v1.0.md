# Test MEMORY-POLICY-SQLITE-001 v1.0

## Schema Tests

- [x] Migration alters the existing `memories` table.
- [x] `always_include` defaults to zero and is boolean constrained.
- [x] Confidence accepts zero, one, and null.
- [x] Confidence rejects values below zero and above one.
- [x] Extraction method accepts explicit, LLM extraction, system, and null.
- [x] Unknown extraction methods are rejected.
- [x] Supersession can reference an existing Memory.
- [x] Topic key and origin Response ID persist.
- [x] No `memory_provenance` table is created.
- [x] No raw-thinking, prompt, or provider payload columns are added.

## Compatibility Tests

- [x] Existing Memory creation remains valid with defaults/nulls.
- [x] Existing `memory_events` append/list behavior remains unchanged.

## Validation

- [x] Rust format/check/tests: 927 passed.
- [x] npm service check/tests: 927 passed.
- [x] Production build and Vitest: 559 passed across 32 files.
- [x] `git diff --check`.
- [x] `./loom.sh --publish --test`.
- [x] Electron dev package build.
- [x] Live debug and packaged sidecar health verification.

## Runtime Evidence

Fresh debug and packaged binaries both applied migration 25 to isolated databases and exposed all six policy columns. Live loopback verification successfully confirmed service health and migration schemas without mismatch errors.
