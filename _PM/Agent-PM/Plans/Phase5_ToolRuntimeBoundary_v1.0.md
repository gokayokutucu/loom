# Phase 5: Tool Runtime Boundary Plan v1.0

## Objective
Define the first Loom-native Tool Runtime boundary inside `loom-service` so AgentRuntime can model tool requests, permission decisions, and safe outcomes before any tool execution exists.

## Scope & Prerequisites
- Builds on AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001 / AGENT-RUNTIME-CANCELLATION-001 / AGENT-UI-RUN-INSPECTOR-001.
- New `agent_runtime/tools.rs` contract module: `ToolName`, `ToolCallId`, `SafeToolArguments`, `ToolPermissionStatus`/`ToolPermissionDecision`, `ToolInvocationStatus`/`ToolInvocationRequest`/`ToolInvocationResult`/`ToolInvocation`, `ToolRuntimeError`, `ToolRuntimeBoundary`.
- Boundary is an evaluator, not an executor: deny-by-default policy; every invocation returns Skipped/Denied without executing anything. Real execution deferred to TOOL-RUNTIME-REGISTRY-001.
- `SafeToolArguments` redacts credential-shaped keys/values at construction; tool errors and permission reasons pass through sanitization.
- `AgentEvent` gains `ToolPermissionEvaluated`, `ToolCallCompleted`, `ToolCallFailed` (the latter two are future-execution contract only).
- AgentRuntime placeholder tool step now emits Requested → PermissionEvaluated → Skipped through the boundary.
- No MCP, no persistence, no retrieval, no frontend changes (inspector already tolerates unknown event types).

## Changelog
- **v1.0**: Initial plan for TOOL-RUNTIME-BOUNDARY-001.
