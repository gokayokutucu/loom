# Task: AGENTRUN-CONTEXT-CONSUMPTION-001 v1.0

## Objective

Wire the legacy V1 `ContextManager` + contributors path into `AgentRuntime` execution so AgentRun can consume production context without bypassing attachments, capsules, Wefts, references, memory, or retrieval behavior.

## Checklist

- [x] Read `docs/context_pipeline_flow_audit.md`.
- [x] Read `docs/context_integration_spec_amendment.md`.
- [x] Read `docs/context_pipeline_agent_integration_design.md`.
- [x] Read V1/V2 boundary documents.
- [x] Audit legacy `ContextManager` and contributor outputs.
- [x] Audit `AgentRuntime::execute_run`.
- [x] Add optional AgentRuntime context consumption seam.
- [x] Route supplied legacy context through `ContextManager`.
- [x] Convert built context messages into provider contract messages.
- [x] Replace hardcoded `contextBuilt=false` when context is supplied.
- [x] Emit only safe context metadata counts/statuses.
- [x] Preserve existing minimal AgentRuntime request behavior when no context is supplied.
- [x] Keep Main Generation API behavior unchanged.
- [x] Keep Quick Ask behavior unchanged.
- [x] Avoid ProviderRuntime bridge work.
- [x] Avoid ContextManager/contributor behavior changes.
- [x] Avoid new retrieval logic.
- [x] Avoid snapshot schema changes.
- [x] Add tests for legacy context consumption.
- [x] Add tests for privacy of durable AgentRun events.
- [x] Run full validation.
- [x] Commit if validation passes.

## Out Of Scope

- [x] No Quick Ask migration.
- [x] No Main Generation shim.
- [x] No ProviderRuntimeBridge.
- [x] No tool/MCP runtime work.
- [x] No new migrations.
- [x] No UI changes.
- [x] No push.
