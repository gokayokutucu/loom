# Test TOOL-ARTIFACTS-001 v1.0

## Test Objective

Prove Tool Artifact references are durable, metadata-only, lifecycle-aware, and hidden after soft deletion unless explicitly requested.

## Expected Coverage

- [x] Artifact reference can be created for an existing invocation.
- [x] Artifact reference can be read by `artifact_id`.
- [x] Artifact references can be listed by `invocation_id`.
- [x] Artifact references can be listed by `agent_run_id`.
- [x] Artifact references can be listed by `root_run_id`.
- [x] Soft-deleted artifact references are hidden from default get/list paths.
- [x] Explicit include-deleted repository path returns soft-deleted artifacts.
- [x] Invalid invocation reference fails.
- [x] Forbidden artifact metadata markers are rejected.
- [x] Unsupported artifact kind is rejected.
- [x] Unsupported artifact visibility is rejected.
- [x] No content/raw_output/stdout/stderr columns are used.
- [x] Existing Tool Permission Model tests still pass under full service test run.
- [x] Existing Tool Scheduler schema tests still pass under full service test run.

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

- v1.0: Initial test plan for Tool Artifact lifecycle repository policy.
