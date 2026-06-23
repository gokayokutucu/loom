# Test TOOL-PERMISSION-MODEL-001 v1.0

## Test Objective

Prove Tool Permission Model repository policy authorizes only explicit active grants and preserves Tool Scheduler privacy boundaries.

## Expected Coverage

- [x] Permission request can be created as pending.
- [x] Pending grant does not authorize.
- [x] Granted one-time grant authorizes, with consumption deferred and documented.
- [x] Granted run-scope grant authorizes the same run.
- [x] Parent run grant does not authorize child by default.
- [x] Explicit root-run grant authorizes child.
- [x] Session/workspace scopes authorize within current root-run schema boundary.
- [x] Denied grant does not authorize.
- [x] Revoked grant does not authorize.
- [x] Expired grant does not authorize.
- [x] Unknown tool does not authorize.
- [x] Unknown run does not authorize.
- [x] Permission metadata rejects forbidden markers.
- [x] Unsupported permission scope is rejected.
- [x] No raw payload/content/prompt/provider/raw-thinking columns are used.
- [x] Existing Tool Scheduler tests pass under full service test run.

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

- v1.0: Initial test plan for Tool Permission Model repository policy.
