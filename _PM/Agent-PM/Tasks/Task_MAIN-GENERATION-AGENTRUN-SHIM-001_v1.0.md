# Task MAIN-GENERATION-AGENTRUN-SHIM-001 v1.0

Status: ACTIVE
Phase: P20 Multi-Agent Execution Topology
Epic: AgentRun production shims

## Objective

Shim the V1 Main Generation orchestration path so it creates and uses durable AgentRun metadata while preserving the existing API, SSE stream, ContextManager, and provider execution behavior.

## Scope

- [x] Audit required context pipeline, boundary, orchestration, AgentRuntime, and AgentRun repository documents/code.
- [x] Preserve V1 Main Generation request/response and streaming semantics.
- [x] Create durable AgentRun metadata for main generation after the legacy ContextManager builds context.
- [x] Supply the same legacy `BuildContextInput` to the AgentRuntime seam as `legacyContext`.
- [x] Persist only safe AgentRun lifecycle/context metadata; no prompt, raw context body, provider payload, or raw thinking.
- [x] Mirror completed generation into AgentRun terminal state.
- [x] Mirror failed generation into AgentRun terminal state.
- [x] Mirror cancelled provider event into AgentRun terminal state when the existing path emits cancellation.
- [x] Leave Quick Ask unchanged as the V1 fast path.
- [x] Leave ProviderRuntimeBridge on hold.
- [x] Run full validation.
- [x] Run runtime verification with isolated debug service.
- [x] Run Electron packaging and packaged sidecar verification.
- [x] Commit if validation passes.

## Notes

- The shim intentionally does not route live provider streaming through AgentRuntime yet.
- The existing `ProviderPipeline::stream_chat` path remains the production streaming path until ProviderRuntimeBridge is promoted.
