# Test TOOL-SCHEDULER-SCHEMA-001 v1.0

## Test Objective

Prove Tool Scheduler persistence exists, enforces safe AgentRun-linked storage, and does not introduce raw payload/content/prompt/provider/thinking persistence.

## Expected Coverage

- [x] Migration creates `tool_definitions`.
- [x] Migration creates `tool_invocations`.
- [x] Migration creates `tool_artifacts`.
- [x] Migration creates `tool_permission_grants`.
- [x] Migration 0028 records `tool_scheduler_foundation`.
- [x] Tool definition can be created, read, and listed.
- [x] Tool invocation can be created for an existing AgentRun.
- [x] Missing AgentRun is rejected for invocation creation.
- [x] Invocation status transitions persist.
- [x] Terminal invocation transition is idempotently rejected without overwrite.
- [x] Artifact reference persists without content storage.
- [x] Permission grant persists.
- [x] Permission grant revokes idempotently.
- [x] `diagnostics_json` rejects forbidden raw thinking markers.
- [x] Tool scheduler tables do not include raw payload/content/prompt/provider/thinking columns.
- [x] Existing AgentRun tests pass under full service test run.

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

- v1.0: Initial test plan for Tool Scheduler storage foundation.
