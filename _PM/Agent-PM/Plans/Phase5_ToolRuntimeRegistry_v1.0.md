# Phase 5: Tool Runtime Registry Plan v1.0

## Objective
Build on `TOOL-RUNTIME-BOUNDARY-001` by adding a Loom-native Tool Registry contract inside `loom-service`. The registry models what tools exist, their metadata, availability, permission requirements, and execution readiness without executing real tools.

## Scope & Prerequisites
- Builds on `TOOL-RUNTIME-BOUNDARY-001`.
- New `agent_runtime/tool_registry.rs` contract module.
- Registry is metadata-only: availability, permission requirements, and schemas.
- Tool execution remains deferred/not implemented (always skipped/denied).
- Minimal integration with `ToolRuntimeBoundary`.
- No MCP, no SQLite persistence, no approval UI.

## Proposed Changes
- `services/loom-service/src/agent_runtime/tool_registry.rs` [NEW]
- `services/loom-service/src/agent_runtime/mod.rs` [MODIFY]
- `services/loom-service/src/agent_runtime/tools.rs` [MODIFY]

## Verification Plan
- Unit tests in `tool_registry.rs` checking resolution, permission mapping, safety.
- `cargo test` and `./loom.sh --test` to ensure all tests pass.

## Changelog
- **v1.0**: Initial plan for `TOOL-RUNTIME-REGISTRY-001`.
