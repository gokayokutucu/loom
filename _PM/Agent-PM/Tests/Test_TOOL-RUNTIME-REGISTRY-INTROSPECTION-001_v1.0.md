# Test: TOOL-RUNTIME-REGISTRY-INTROSPECTION-001 v1.0

## Verification checklist
- [ ] Test route gating: disabled flag returns 404, enabled flag returns 200 OK
- [ ] Test list tools returns the expected metadata-only list of registered tools
- [ ] Test response DTO includes `count`, `registryStatus` ("available"), and `executionEnabled: false`
- [ ] Test route does not serialize any forbidden strings (e.g. raw_thinking, Bearer, apiKey)
- [ ] Test route performs no tool execution side-effects
- [ ] Test compile-time static code guard checks that `agent_experimental.rs` performs no process, filesystem, or network execution primitives
