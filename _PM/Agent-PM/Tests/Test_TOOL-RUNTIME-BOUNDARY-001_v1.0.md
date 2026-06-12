# Test: TOOL-RUNTIME-BOUNDARY-001 v1.0

- [x] Unknown tool returns stable safe result (Skipped + UnknownTool decision, no error, no output).
- [x] Denied tool returns Denied without executing.
- [x] Allowed tool is Skipped with `TOOL_EXECUTION_NOT_IMPLEMENTED` (execution deferred even when permitted).
- [x] `SafeToolArguments` redacts sensitive keys (`Authorization`, `api_key`, `apiKey`, `client_secret`, `password`, `token`) and bearer-style values, recursively, while preserving safe fields.
- [x] Permission decisions serialize safely for all six statuses.
- [x] `ToolRuntimeError` and permission reasons sanitize credential-shaped text.
- [x] Full `ToolInvocation` (request + result) serializes without forbidden strings.
- [x] Static guard: tools module source contains no `std::process`, `Command::new`, `std::fs::`, `std::net`, `TcpStream`, `reqwest`, `tokio::process`, `tokio::fs`.
- [x] AgentRuntime lifecycle test updated: placeholder tool step emits Requested → PermissionEvaluated(UnknownTool) → Skipped; 13-event order asserted.
- [x] AgentEvent serialization sweep extended with `ToolPermissionEvaluated`/`ToolCallCompleted`/`ToolCallFailed` and forbidden markers `apiKey`/`api_key`/`secret`.
- [x] Existing Main generation / Quick Ask static guards still pass; experimental route suite unaffected.
- [x] Frontend: no changes; existing inspector vitest suite passes (tolerant unknown-event parsing).
