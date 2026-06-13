# Phase 5: Tool Runtime Registry Shared State Plan v1.0

## Objective
Ensure both the `AgentRuntime` execution flow and the experimental introspection route `GET /experimental/agent/tools` query the exact same process-local `ToolRegistry` instance.

## Scope & Prerequisites
- Builds on `TOOL-RUNTIME-REGISTRY-INTROSPECTION-001`.
- shared state ownership via `AppState` using `Arc<RwLock<ToolRegistry>>`.
- No new tools or execution capability.
- No UI components or database persistence.

## Proposed Changes
- `services/loom-service/src/api/state.rs` [MODIFY]
- `services/loom-service/src/api/mod.rs` [MODIFY]
- `services/loom-service/src/api/agent_experimental.rs` [MODIFY]
- `services/loom-service/src/agent_runtime/tools.rs` [MODIFY]
- `services/loom-service/src/agent_runtime/runtime.rs` [MODIFY]
- `services/loom-service/src/agent_runtime/service.rs` [MODIFY]

## Verification Plan
- Unit tests verifying registry sharing between routes and boundary.
- `cargo test` and `./loom.sh --test` to ensure all checks pass.

## Changelog
- **v1.0**: Initial plan for `TOOL-RUNTIME-REGISTRY-SHARED-STATE-001`.
