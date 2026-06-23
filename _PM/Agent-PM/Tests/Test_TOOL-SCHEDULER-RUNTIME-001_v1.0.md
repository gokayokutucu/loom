# Test TOOL-SCHEDULER-RUNTIME-001 v1.0

## Test Objective

Prove Tool Scheduler runtime orchestration persists safe invocation lifecycle state, enforces permission decisions, supports cancellation/timeout, and executes only a no-I/O noop test tool.

## Expected Coverage

- [x] Missing permission returns `permission_required` and does not execute.
- [x] Runtime creates pending permission request record.
- [x] Granted permission transitions `requested -> queued -> running -> completed` for noop.
- [x] Denied permission returns `permission_denied` without execution.
- [x] Queued cancellation transitions to `cancelled`.
- [x] Running timeout transitions to `timed_out`.
- [x] Runtime creates safe invocation records.
- [x] Runtime creates safe metadata-only noop artifact ref.
- [x] Forbidden request metadata is rejected before persistence.
- [x] Raw output/stdout/stderr is never stored.
- [x] Existing permission model tests still pass under full service test run.
- [x] Existing artifact lifecycle tests still pass under full service test run.
- [x] AgentRun state machine tests still pass under full service test run.

## Validation Results

- [x] Rust format passed.
- [x] Rust check passed.
- [x] Rust tests passed.
- [x] Service check passed.
- [x] Service tests passed.
- [x] Frontend build passed.
- [x] Vitest passed.
- [x] Loom publish/test passed.
- [x] Electron package passed.

## Changelog

- v1.0: Initial test plan for Tool Scheduler runtime seam.
