# Task: TOOL-RUNTIME-REGISTRY-SHARED-STATE-001 v1.0

## Objective
Ensure both the `AgentRuntime` execution flow and the experimental introspection route `GET /experimental/agent/tools` query the exact same process-local `ToolRegistry` instance.

## Checklist
- [x] Add `tool_registry` to `AppState` in `services/loom-service/src/api/state.rs`
- [x] Initialize and seed `tool_registry` inside `services/loom-service/src/api/mod.rs`
- [x] Update `list_tools` route handler in `services/loom-service/src/api/agent_experimental.rs`
- [x] Refactor `ToolRuntimeBoundary` in `services/loom-service/src/agent_runtime/tools.rs` to hold `Arc<RwLock<ToolRegistry>>`
- [x] Add `tool_registry` to `AgentRuntime` in `services/loom-service/src/agent_runtime/runtime.rs`
- [x] Add constructors to `AgentRuntimeService` in `services/loom-service/src/agent_runtime/service.rs`
- [x] Add unit tests verifying shared registry visibility
- [x] Run cargo check, test, and formatting checks
- [x] Commit changes locally with message `fix: share tool registry across runtime and introspection`
