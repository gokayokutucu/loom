# Test TOOL-REGISTRY-BRIDGE-001 v1.0

## Test Objective

Prove the legacy Agent Runtime tool registry compatibility layer delegates tool definition ownership to the SQLite-backed Tool Scheduler repository while preserving existing safe no-execution behavior.

## Expected Coverage

- [x] Legacy registry tool can be seeded into `ToolSchedulerRepository`.
- [x] Scheduler repository remains canonical after bridge seeding.
- [x] Scheduler definitions can be exposed as compatibility registered tools.
- [x] Built-in noop tool can be registered and discovered through the bridge.
- [x] Repeated bridge initialization does not create duplicate tool definitions.
- [x] Built-in catalog can seed scheduler definitions.
- [x] Old invocation status mapping aligns with scheduler statuses.
- [x] Permission requirement mapping does not auto-grant child AgentRuns.
- [x] No real tool execution is introduced.
- [x] Existing tool scheduler runtime tests still pass under full service test run.
- [x] Existing AgentRun state machine tests still pass under full service test run.

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

- v1.0: Initial test plan for Tool Registry bridge.
