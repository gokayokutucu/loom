# Test: TOOL-RUNTIME-REGISTRY-001 v1.0

## Verification checklist
- [ ] Test registry resolves unknown tool safely to `Unknown` / `UnknownTool` permission decision
- [ ] Test registry resolves disabled tool safely to `Disabled` / `Disabled` permission decision
- [ ] Test registry resolves not configured tool safely to `NotConfigured` / `NotAvailable` permission decision
- [ ] Test registry resolves approval-required tool safely to `RequiresUserApproval` permission decision
- [ ] Test registry resolves always-allowed tool safely to `Resolved` / `Allowed` permission decision
- [ ] Test registry resolves permission evaluation and returns expected `ToolPermissionDecision`
- [ ] Test ToolRuntime with registry executes nothing (returns Skipped or Denied, with `TOOL_EXECUTION_NOT_IMPLEMENTED` error for Allowed tools)
- [ ] Test safe metadata serialization contains no forbidden strings (e.g. raw_thinking, Bearer, apiKey)
- [ ] Test argument/output schema placeholders do not contain secrets
- [ ] Test compile-time static code guard checks that `tool_registry.rs` performs no process, filesystem, or network execution primitives
