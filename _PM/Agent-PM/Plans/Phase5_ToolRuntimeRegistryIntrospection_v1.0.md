# Phase 5: Tool Runtime Registry Introspection Plan v1.0

## Objective
Expose a gated, read-only experimental HTTP introspection route for the Loom-native Tool Registry so developers can inspect registered tool metadata, availability, and permission requirements without executing any tools.

## Scope & Prerequisites
- Builds on `TOOL-RUNTIME-REGISTRY-001`.
- New route: `GET /experimental/agent/tools`.
- Gated behind `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API` environment variable.
- Returns safe metadata only; `executionEnabled: false` is explicitly included.
- No execution capability, no MCP, no persistence, no UI components.

## Proposed Changes
- `services/loom-service/src/agent_runtime/tool_registry.rs` [MODIFY]
- `services/loom-service/src/api/agent_experimental.rs` [MODIFY]
- `services/loom-service/src/api/mod.rs` [MODIFY]

## Verification Plan
- Unit tests in `agent_experimental.rs` checking route gating, JSON response shape, safety, and lack of execution.
- `cargo test` and `./loom.sh --test` to ensure all checks pass.

## Changelog
- **v1.0**: Initial plan for `TOOL-RUNTIME-REGISTRY-INTROSPECTION-001`.
