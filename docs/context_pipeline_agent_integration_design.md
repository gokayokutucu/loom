# Context Pipeline Agent Integration Design

## 1. Executive Summary
Loom is transitioning from a rigid V1 generation pipeline to a V2 Agent Runtime state machine. The V1 Context/Knowledge Layer (Context Selection, Context Manager, Context Snapshots, memory, retrieval, attachments) remains canonical. This document designs how the V2 `AgentRun` consumes the V1 Knowledge Layer, ensuring context operations remain passive (not tools) while decoupling LLM execution from the orchestration layer.

> [!WARNING]
> **AMENDED DESIGN**: This spec has been amended by [context_integration_spec_amendment.md](context_integration_spec_amendment.md). The target lifecycle relying on `AgentContextManager` is the *final* architectural state. However, the *initial* `AgentRun` migration will safely wrap the legacy `ContextManager` (Phase 1) to prevent regression. Do not wire `AgentContextManager` into production without the bridge strategy defined in the amendment.

## 2. Current V1 Context Pipeline
In V1, the orchestration endpoint (`api/orchestration.rs`) synchronously:
1. Receives UI submit.
2. Calls `Context Selection` to rank candidate items.
3. Invokes `AgentContextManager` to assemble the prompt and create a `ContextSnapshot`.
4. Directly invokes `ProviderPipeline::stream_chat` to execute the LLM.
5. Persists the response.

This couples context assembly directly to the execution pipeline, bypassing the Agent state machine.

## 3. Target V2 AgentRun Context Lifecycle
In the target V2 design, context becomes a phase within the `AgentRun` lifecycle:
1. `AgentRun` is created.
2. `AgentRun` state machine enters the `ContextBuild` phase.
3. The state machine invokes `Context Selection` based on the `AgentDefinition`.
4. The state machine invokes `AgentContextManager` to finalize context assembly.
5. `ContextSnapshot` is created/finalized. Exactly one primary context snapshot is created per major reasoning step or `AgentRun` iteration.
6. The `context_snapshot_id` is linked to the `AgentRun`.
7. The finalized context is handed to `ProviderRuntimeService`.

## 4. Ownership Boundaries
- **V1 Knowledge Layer**: Remains the **canonical** source of truth for attachments, memory, capsules, wefts, reference resolution, and retrieval projections.
- **V2 Agent Runtime**: The **canonical** execution layer. It consumes the Knowledge Layer but does not duplicate attachment ingestion, memory storage, or context scoring.
- Raw file/content must not bypass the Knowledge Layer through arbitrary tool usage.

## 5. Main Generation Migration
The current orchestration must be migrated in phases:
- **Phase A (Design-only)**: This document.
- **Phase B (Internal Shim)**: `api/orchestration.rs` is refactored to internally spawn an `AgentRun` but wait synchronously for its completion to preserve the existing API contract.
- **Phase C (Default AgentRun path)**: The UI transitions to using asynchronous `AgentRun` creation and polling/streaming `AgentEvent`s.
- **Phase D (Retire V1 loop)**: The old direct `ProviderPipeline` loop is deprecated and removed.

**Target Path:** UI submit -> AgentRun create -> Context Selection -> AgentContextManager -> ContextSnapshot -> ProviderRuntime -> response persist -> AgentRun complete.

## 6. Quick Ask Migration
Quick Ask (`api/ask.rs`) will migrate to a **lightweight AgentRun**:
- It will use a fast-path `AgentDefinition` that reduces or bypasses deep `Context Selection`.
- It will still generate a minimal `ContextSnapshot` for auditability.
- It will bypass full memory writes (as per V1 design).
- The existing UI API contract will be preserved via a shim, similar to main generation.

## 7. SubAgent Context Inheritance
When an `AgentRun` spawns a child `AgentRun` (SubAgent):
- The child inherits the parent's resolved working context state unless explicitly overridden by its `AgentDefinition`.
- The child does *not* blindly re-run heavy `Context Selection` unless required by a specific subtask.
- The child gets snapshot references pointing to the parent’s context to save space, supplemented by any new context it loads.
- Attachment/reference visibility passes implicitly.
- Memory visibility passes implicitly.
- **No raw thinking inheritance**: Chain-of-thought and raw scratchpad thinking from the parent are never injected into the child's context.

## 8. Context vs Tool Boundary
- **Passive Context Loading**: Injecting data into the context window prior to LLM generation is **NOT** a tool operation.
  - *Examples*: Attachment chunks selected, capsule selection, Weft origin chain selection, memory selection.
- **Active Operations**: Executing logic that mutates state or searches external domains dynamically *during* generation **MAY BE** tools.
  - *Examples*: Reindexing an attachment, inspecting parse status, extracting a table artifact, creating a checkpoint, exporting an artifact.

## 9. Provider Bridge Dependency
This design unblocks the pending `PROVIDER-RUNTIME-BRIDGE-001`.
- `ProviderRuntimeService` must rely on `AgentContextManager` to provide the finalized prompt and context payload.
- `ProviderRuntimeBridge` must **never** bypass the Context Manager to fetch its own context. The context pipeline feeds the bridge.

## 10. Snapshot and Audit Model
- **Content-free Rule**: `ContextSnapshot` must only store reference IDs, candidate scores, and inclusion statuses. It must not store raw string content.
- **No Raw Prompt / Thinking**: Raw expanded prompts and raw chain-of-thought text must not be stored in the snapshot or database.
- **Replay/Explainability**: The system must be able to explain context decisions using candidate IDs alone.

## 11. API Compatibility Plan
- `api/orchestration.rs` and `api/ask.rs` will remain API-compatible for existing frontend clients.
- Under the hood, these V1 shims will instantiate `AgentRun` and translate `AgentEvent`s into the legacy Server-Sent Events (SSE) format where required, until the frontend natively consumes V2 events.
- Client `context_snapshot_id` generation logic and history polling must not break.

## 12. Follow-up Task List
- `MAIN-GENERATION-AGENTRUN-SHIM-001`
- `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001`
- `PROVIDER-RUNTIME-BRIDGE-001`
- `SUBAGENT-CONTEXT-INHERITANCE-001`
- `V1-DIRECT-PROVIDER-PATH-DEPRECATION-001`

## 13. Risks
- **Performance Overhead**: Routing context through an asynchronous state machine might add minor latency to the fast-path Quick Ask.
- **Drift**: Legacy orchestration could accidentally receive new features instead of porting them to `AgentRun`.
- **Complex Shim Translation**: Mapping `AgentEvent` to legacy `orchestration` events could be brittle.

## 14. Final Recommendation
Lock down the Context/Knowledge Layer as canonical V1 infrastructure. Unblock `PROVIDER-RUNTIME-BRIDGE-001` immediately now that the boundary dictates `AgentContextManager` feeds `ProviderRuntimeService`. Proceed with shimming `api/orchestration.rs` to validate the integration.

## 15. ROADMAP STATUS
- **Current Phase**: P11 Drift Remediation
- **Current Epic**: Context Pipeline Agent Integration
- **Current Task**: CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001
