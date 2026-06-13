# Task: TOOL-RUNTIME-REGISTRY-INTROSPECTION-001 v1.0

## Objective
Add a safe, gated experimental HTTP introspection route for the Loom-native Tool Registry so developers can inspect registered tool metadata, availability, and permission requirements without executing any tools.

## Checklist
- [ ] Implement `pub fn list(&self) -> Vec<RegisteredTool>` in `services/loom-service/src/agent_runtime/tool_registry.rs`
- [ ] Define `EXPERIMENTAL_AGENT_TOOLS_PATH` path constant, response DTO, and handler in `services/loom-service/src/api/agent_experimental.rs`
- [ ] Mount `/experimental/agent/tools` inside `services/loom-service/src/api/mod.rs` under the experimental agent runtime flag
- [ ] Add unit tests in `agent_experimental.rs` verifying route gating, JSON serialization safety, and lack of execution
- [ ] Run cargo format, check, and test validations
- [ ] Commit changes locally with message `feat: add tool registry introspection route`
