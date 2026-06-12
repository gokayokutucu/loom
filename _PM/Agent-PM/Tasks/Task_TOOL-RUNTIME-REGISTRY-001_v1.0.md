# Task: TOOL-RUNTIME-REGISTRY-001 v1.0

## Objective
Add Loom-native Tool Registry contracts inside `loom-service` to model tool existence, metadata, availability, permission requirements, and execution readiness without executing real tools.

## Checklist
- [ ] Implement `ToolAvailability`, `ToolPermissionRequirement`, `RegisteredTool`, `ToolRegistryResolution`, and `ToolRegistry` in `services/loom-service/src/agent_runtime/tool_registry.rs`
- [ ] Add unit tests in `tool_registry.rs` verifying resolution, permission mapping, safety, and compile-time check
- [ ] Register `tool_registry` module in `services/loom-service/src/agent_runtime/mod.rs`
- [ ] Update `ToolRuntimeBoundary` in `services/loom-service/src/agent_runtime/tools.rs` to wrap `ToolRegistry` and preserve backwards compatibility
- [ ] Update `services/loom-service/src/agent_runtime/runtime.rs` tests to compile and run properly
- [ ] Run cargo format, check, and test validations
- [ ] Commit changes locally with message `feat: add tool runtime registry contracts`
