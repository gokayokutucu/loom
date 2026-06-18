# Test AGENT-CONTEXT-MANAGER-001 v1.0

## Functional Tests

- [x] Resolve canonical SQLite content instead of retrieval previews.
- [x] Apply full, summary, hidden-background, and budget exclusion decisions.
- [x] Preserve mandatory content or return explicit token overflow.
- [x] Keep hidden background in a dedicated structured section.
- [x] Finalize snapshot candidate metadata and Agent Run linkage.
- [x] Reject raw-thinking markers at the SQLite read boundary.
- [x] Persist no resolved content in snapshot telemetry.
- [x] Invoke no provider, Main, Quick Ask, MCP, or tool path.

## Validation

- [x] Rust format check.
- [x] Rust check.
- [x] Full Rust tests: 926 passed.
- [x] npm service check and tests: 926 passed.
- [x] Production build.
- [x] Full Vitest suite: 559 passed across 32 files.
- [x] `git diff --check`.
- [x] `./loom.sh --publish --test`.
- [x] Electron dev packaging.
- [x] Fresh debug and packaged service health verification.

## Validation Evidence

- `./loom.sh --publish --test` passed successfully.
- Fresh debug and packaged service `/health` checks verified and completed successfully.
