# Task TOOL-SCHEDULER-BRIDGE-001 v1.0

## Objective

Route AgentRuntime tool-placeholder scheduling through the canonical SQLite-backed Tool Scheduler without executing a real tool.

## Scope

- [x] Audit Tool Runtime state, registry drift, adapter contract, scheduler, repository, and AgentRuntime.
- [x] Inject `ToolSchedulerRuntime` into `AgentRuntime`.
- [x] Replace the hardcoded legacy `dummy_placeholder_tool` invocation path.
- [x] Persist the placeholder invocation through `ToolSchedulerRepository`.
- [x] Resolve adapter availability through the `ToolAdapter` contract.
- [x] Return metadata-only `skipped/tool_adapter_not_implemented` when no adapter exists.
- [x] Preserve the legacy in-memory registry for compatibility discovery only.
- [x] Add focused bridge, no-execution, and privacy tests.

## Out Of Scope

- [x] No File, Web, OCR, Shell, MCP, or other real adapter.
- [x] No provider, Main Generation, Quick Ask, ContextManager, or frontend change.
- [x] No execution graph or second provider turn.
- [x] No push.

## Status

- [x] Implementation complete.
- [x] Validation complete.
