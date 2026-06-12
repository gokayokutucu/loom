# Task: TOOL-RUNTIME-BOUNDARY-001 v1.0

- [x] Add `services/loom-service/src/agent_runtime/tools.rs` with tool contract types
- [x] Model explicit permission decisions (Allowed, Denied, RequiresUserApproval, NotAvailable, Disabled, UnknownTool)
- [x] Implement `ToolRuntimeBoundary` placeholder: evaluates requests, never executes; deny-by-default (unknown tool) policy
- [x] `SafeToolArguments` wrapper: untrusted JSON with credential key/value redaction at construction
- [x] Sanitized `ToolRuntimeError` and permission reasons
- [x] Extend `AgentEvent` with `ToolPermissionEvaluated`, `ToolCallCompleted`, `ToolCallFailed`
- [x] Route AgentRuntime placeholder tool step through the boundary (Requested → PermissionEvaluated → Skipped)
- [x] Tests: skipped/denied/unknown results, redaction, sanitization, serialization sweeps, no-execution static guard
- [x] PM docs (Plan/Task/Test)
- [x] Full validation incl. `./loom.sh --publish --test`

## Decision Notes

- **Contract only.** The boundary evaluates and records; it executes nothing. All invocations return Skipped (or Denied), even for `Allowed` tools, with a stable `TOOL_EXECUTION_NOT_IMPLEMENTED` error code for allowed-but-unimplemented tools.
- **No MCP.** MCP remains deferred to MCP-BOUNDARY-001.
- **No persistence.** Tool invocations are not stored in SQLite; no migrations.
- **Permission model exists** before execution exists, so future tools cannot ship without a decision path.
- **Tool calls remain placeholder/skipped** in the AgentRuntime stream; event order is StepStarted → ToolCallRequested → ToolPermissionEvaluated → ToolCallSkipped.
- **Raw thinking/secrets remain blocked.** New event variants carry identifiers, status enums, and sanitized text only; serialization sweep now also rejects `apiKey`/`api_key`/`secret`. A static guard asserts the tools module contains no process/filesystem/network primitives.
- **No frontend change needed.** The Agent Run Inspector parser already tolerates unknown event types (verified by existing vitest suite).

## Next Likely Tasks

- TOOL-RUNTIME-REGISTRY-001
- TOOL-PERMISSION-UI-001
- MCP-BOUNDARY-001
- AGENT-RUN-PERSISTENCE-001
- RETRIEVAL-ARCH-001
