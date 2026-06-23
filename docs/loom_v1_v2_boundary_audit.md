# Loom v1 vs v2 Boundary Audit

## 1. Executive Summary
Loom is transitioning from a rigid, linearly coupled generation pipeline (v1) to an asynchronous, decoupled Agent Runtime (v2). This audit defines the hard boundary between these two systems. Crucially, the existing Context Pipeline (selection, assembly, parsing) is **not** being retired; it is being formally recast as the **Loom Knowledge Layer**, consumed by the v2 Agent Runtime. This document establishes canonical ownership, defines which components become shims or face deprecation, and sets strict rules to prevent architectural drift.

## 2. V1 Inventory
The v1 system is primarily centered around the `api/orchestration.rs` and `api/ask.rs` synchronous lifecycles.

- **Main Generation Path (`api/orchestration.rs`)**
  - **Purpose**: End-to-end orchestration of user input, context selection, and LLM streaming.
  - **Owner**: Legacy Orchestration.
  - **Status**: **Active (Shim pending)**. Needs to be hollowed out to delegate to `AgentRun`.
- **Quick Ask Path (`api/ask.rs`)**
  - **Purpose**: Fast-path querying bypassing deep context.
  - **Owner**: Legacy Orchestration.
  - **Status**: **Active (Shim pending)**. Needs to delegate to a lightweight `AgentRun`.
- **Context Selection (`context_selection.rs`)**
  - **Purpose**: Scoring and ranking candidate context objects.
  - **Owner**: Knowledge Layer.
  - **Status**: **Active (Canonical)**.
- **Context Manager (`agent_context_manager.rs`)**
  - **Purpose**: Prompt assembly, snapshot generation, token accounting.
  - **Owner**: Knowledge Layer.
  - **Status**: **Active (Canonical)**.
- **Retrieval Projections (`retrieval/`)**
  - **Purpose**: Fetching attachments, Wefts, and graph objects.
  - **Owner**: Knowledge Layer.
  - **Status**: **Active (Canonical)**.
- **Storage / Memory System (`storage/`, SQLite)**
  - **Purpose**: Persistence of graph objects, checkpoints, capsules.
  - **Owner**: Persistence Layer.
  - **Status**: **Active (Canonical)**.

## 3. V2 Inventory
The v2 system is centered around `AgentRun`, subagents, and decoupled runtimes.

- **Agent Runtime (`agent_runtime/`)**
  - **Purpose**: State machine, lifecycle management, and event bus for `AgentRun` and `AgentDefinition`.
  - **Owner**: V2 Runtime.
  - **Status**: **Active (Canonical)**.
- **Provider Runtime Seam (`provider_runtime.rs`)**
  - **Purpose**: Safe execution boundary and metadata tracking for LLM providers.
  - **Owner**: V2 Runtime.
  - **Status**: **Disconnected**. Needs bridge to `AgentRuntime`.
- **Tool Scheduler (`tool_scheduler_runtime.rs`)**
  - **Purpose**: Execution, parallelization, and ownership/permission guards for tools.
  - **Owner**: V2 Runtime.
  - **Status**: **Disconnected**. Needs bridge to tool registry.
- **Subagent Runtime (`subagent_runtime_design`)**
  - **Purpose**: Orchestration of child `AgentRun` instances.
  - **Owner**: V2 Runtime.
  - **Status**: **Design only**.

## 4. Component Classification Matrix

| Component | Classification | Notes |
| :--- | :--- | :--- |
| `api/orchestration.rs` | **C. V1 shim pending replacement** | Will wrap `AgentRun` creation. |
| `api/ask.rs` | **C. V1 shim pending replacement** | Will wrap lightweight `AgentRun`. |
| `context_selection.rs` | **A. V1 canonical** | Becomes part of Knowledge Layer. |
| `agent_context_manager.rs`| **A. V1 canonical** | Becomes part of Knowledge Layer. |
| `retrieval/` | **A. V1 canonical** | Becomes part of Knowledge Layer. |
| `storage/` | **A. V1 canonical** | Becomes part of Knowledge Layer. |
| `runtime.rs` (legacy) | **D. V1 deprecated** | Replaced by `agent_runtime/`. |
| `agent_runtime/` | **E. V2 canonical** | Core orchestration. |
| `provider_runtime.rs` | **E. V2 canonical** | Core provider boundary. |
| `tool_scheduler_runtime`| **E. V2 canonical** | Core tool execution. |

## 5. Context Pipeline Decision
**The existing Context pipeline is NOT retired.**
It is formally designated as the **Loom Knowledge Layer**, consumed by the v2 Agent Runtime.
- **Attachments** remain canonical data sources.
- **Capsules** remain canonical summaries.
- **Weft history** remains canonical conversation lineage.
- **Context Selection** remains the canonical candidate selection engine.
- **Context Manager** remains the canonical prompt/context assembly engine.
- **Context Snapshot** remains the canonical context audit artifact.

## 6. Tool vs Context Boundary
We must strictly differentiate between passive context and active operations:

**Passive (Not a Tool, belongs to Knowledge Layer):**
- Selecting attachment chunks into context.
- Selecting capsules or Weft origin chains into context.
- Injecting semantic memory into context.

**Active (Tool, belongs to Tool Scheduler):**
- Reindexing an attachment.
- Extracting a table artifact.
- Inspecting parse status.
- Creating a checkpoint.
- Exporting an artifact.
- Running an external search.

*Rule: If it mutates state or fetches non-Loom external data dynamically during generation, it is a tool.*

## 7. Main Generation Migration Path
The current main generation (`api/orchestration.rs`) must migrate incrementally.

**Current:**
`UI submit -> context build -> provider call -> response persist`

**Target:**
`UI submit -> AgentRun create -> ContextSnapshot build -> ProviderRuntime -> response persist -> AgentRun complete`

**Migration Steps:**
1. **What stays**: UI API contract, response structure.
2. **What is wrapped**: The orchestration endpoint becomes a shim that instantiates an `AgentRun`.
3. **What is replaced**: The direct `ProviderPipeline` streaming loop is replaced by `AgentRun`'s internal state machine leveraging `ProviderRuntimeService`.
4. **Safety Constraint**: Legacy clients must not break. Context Snapshot IDs must remain valid.

## 8. Quick Ask Migration Path
Quick Ask (`api/ask.rs`) will become a **lightweight `AgentRun`**.
It will utilize the standard v2 `AgentRun` infrastructure but with an `AgentDefinition` tailored for zero-context, fast-path execution (e.g., bypassing `Context Selection` entirely).
**Phases:**
1. Keep v1 Quick Ask intact.
2. Introduce lightweight `AgentDefinition` for Quick Ask in v2.
3. Switch `api/ask.rs` to instantiate this `AgentRun`.

## 9. Deprecation Marker Strategy
To enforce these boundaries at the source level, we will use the following markers (in comments):

- `// @V1_CANONICAL`: For Context, Retrieval, Memory. Safe to develop.
- `// @V1_CONSUMED_BY_V2`: For structs/enums shifting into AgentRun.
- `// @V1_SHIM`: For endpoints like `/orchestration` wrapping v2 logic.
- `// @V1_DEPRECATED`: For legacy execution loops (e.g., old `runtime.rs`).
- `// @V2_CANONICAL`: For `agent_runtime/`, `tool_scheduler`, etc.
- `// @V2_EXPERIMENTAL`: For incomplete v2 subsystems.
- `// @NEEDS_BRIDGE`: For disconnected components (e.g., `ProviderRuntimeService`).
- `// @NEEDS_RETIREMENT`: For dead code pending deletion.

*(Do not apply these markers automatically; use them manually during refactors.)*

## 10. No-New-Feature Rules
To prevent architectural drift:
- **`api/orchestration.rs` and legacy execution loops**: MUST NOT receive new features. Bug fixes and v2 integration ONLY.
- **`agent_runtime/` and `tool_scheduler`**: Primary target for all new execution logic.
- **Knowledge Layer (`context_selection`, `agent_context_manager`)**: May receive features specifically aimed at improving retrieval, chunking, or ranking.
- **Future Agents**: Any agent attempting to add new execution logic to `api/orchestration.rs` must be blocked by the `report_drift_detected` gate.

## 11. Bridge Task List
Concrete follow-up tasks to execute this migration:
- **CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001**: Design how `AgentRun` invokes `Context Manager`.
- **MAIN-GENERATION-AGENTRUN-SHIM-001**: Hollow out `api/orchestration.rs` to wrap `AgentRun`.
- **QUICK-ASK-AGENTRUN-SHIM-DESIGN-001**: Design the lightweight `AgentDefinition` for Quick Ask.
- **PROVIDER-RUNTIME-BRIDGE-001**: Hook `AgentRuntime` to `ProviderRuntimeService`.
- **V1V2-DEPRECATION-MARKERS-001**: Apply source-level markers across the codebase.
- **V1-DEAD-CODE-AUDIT-001**: Identify code orphaned by the v2 transition.

## 12. Risk Analysis
- **Bypassing Context Manager**: If `AgentRun` tries to build prompts manually, it will break token accounting and privacy guardrails.
- **Orphaning v1 Data**: If `AgentRun` responses are not correctly wired into `Weft` history, lineage will break.
- **Two Provider Paths**: If `PROVIDER-RUNTIME-BRIDGE-001` is delayed, we risk maintaining two separate LLM streaming implementations.
- **Two Tool Registries**: If `TOOL-REGISTRY-BRIDGE-001` is not prioritized, tool state will fracture.
- **Roadmap Drift**: Future agents might ignore this boundary and add features to `api/orchestration.rs`. Enforcing the `No-New-Feature` rules via agent prompts is critical.

## 13. Final Recommendation
Lock down all legacy orchestration paths immediately. Prioritize `PROVIDER-RUNTIME-BRIDGE-001` and `CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001` to safely funnel all generation traffic through the new v2 `AgentRun` state machine while preserving the robust v1 Knowledge Layer.
