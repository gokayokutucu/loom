# Task: TOOL-RUNTIME-REGISTRY-SHARED-STATE-001 v1.0

## Objective
Ensure both the `AgentRuntime` execution flow and the experimental introspection route `GET /experimental/agent/tools` query the exact same process-local `ToolRegistry` instance.

## Checklist
- [x] Add `tool_registry` to `AppState` in `services/loom-service/src/api/state.rs`
- [x] Initialize empty `tool_registry` inside `services/loom-service/src/api/mod.rs` (corrected to empty by default)
- [x] Update `list_tools` route handler in `services/loom-service/src/api/agent_experimental.rs`
- [x] Refactor `ToolRuntimeBoundary` in `services/loom-service/src/agent_runtime/tools.rs` to hold `Arc<RwLock<ToolRegistry>>`
- [x] Add `tool_registry` to `AgentRuntime` in `services/loom-service/src/agent_runtime/runtime.rs`
- [x] Add constructors to `AgentRuntimeService` in `services/loom-service/src/agent_runtime/service.rs`
- [x] Add unit tests verifying shared registry visibility using test-only registration
- [x] Run cargo check, test, and formatting checks
- [x] Correct premature startup seeding by removing placeholder tool registration from mod.rs and updating default routing test
- [x] Commit correction locally with message `fix: keep shared tool registry empty by default`

## Seed Correction Notes
- **Shared Registry Architecture**: Stays fully accepted. Both execution loop and introspection handler look up tools from the same process-local registry.
- **Empty by Default**: Production app starts with an empty ToolRegistry. No placeholder tools are seeded at startup.
- **Test-Only Seeding**: The dynamic visibility test registers its own metadata-only tool during test execution.
- **Execution Guard**: Stays fully active. No tool runs; all resolved/allowed tools skip execution with `TOOL_EXECUTION_NOT_IMPLEMENTED`.
- **TOOL-RUNTIME-REGISTRY-SEED-001**: Stays as `NEXT` in the roadmap ledger.
