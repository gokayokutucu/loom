# Test: TOOL-RUNTIME-REGISTRY-SHARED-STATE-001 v1.0

## Verification checklist
- [x] Test cross-boundary visibility: registering a tool dynamically in `tool_registry` is visible during runtime resolution and introspection
- [x] Test multiple `AppState::agent_runtime()` calls reference the same shared registry instance
- [x] Test `GET /experimental/agent/tools` does not construct a separate registry
- [x] Test default registry starts empty in production/startup (count = 0, registryStatus = "empty")
- [x] Test dynamic tool registration remains restricted to tests and works cross-boundary
- [x] Run full project validation (`cargo test`, `./loom.sh --test`)
