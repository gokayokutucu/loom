# Tool Runtime Implementation State Audit v1.0

Status: AUDIT COMPLETE — documentation only, no source code modified
Task: `TOOL-RUNTIME-IMPLEMENTATION-STATE-AUDIT-001`

## 0. Method

This audit treats `services/loom-service/src/` as the only source of truth. Prior docs (`docs/runtime_architecture_state_audit.md`, `docs/tool_runtime_registry_drift_audit.md`) were read for context but every claim below was independently re-verified against current source — where this audit narrows or corrects them, that is called out explicitly rather than assumed. No source code was modified, refactored, or fixed in producing this document. No roadmap percentage is cited or relied upon.

---

## 1. Component-by-Component Audit

### 1. Tool Registry

- **Classification: FOUNDATION ONLY**
- **Current owner**: `agent_runtime/tool_registry.rs` (`ToolRegistry`, in-memory `HashMap<ToolName, RegisteredTool>`).
- **Production callers**: `AgentRuntime::execute_run` (`agent_runtime/runtime.rs`), via `ToolRuntimeBoundary::with_shared_registry`. Reachable only through the gated experimental route (`LOOM_EXPERIMENTAL_AGENT_RUNTIME_API`), not from Main Generation or Quick Ask.
- **Repository owner**: none — purely in-memory, process-lifetime, no SQLite backing.
- **Current dependencies**: `agent_runtime/catalog.rs` (seeds it with exactly 4 descriptors at construction).
- **Current execution path**: registry lookup only (`get`/`is_available`-style methods) — it never executes anything itself; execution is delegated to `ToolRuntimeBoundary`.
- **Current lifecycle**: none — it's a static lookup table built once per process and never mutated after seeding (no register/unregister API exercised by any caller).
- **Persistence**: none.
- **Remaining work**: either get superseded by `ToolSchedulerRepository` (the SQLite-backed equivalent, see #3) or be formally retired once that bridge lands.
- **What is missing**: a real registration API used by anything other than the hardcoded catalog seed; any notion of versioning or dynamic tool discovery.
- **Drift**: this is the exact duplicate-registry condition `docs/tool_runtime_registry_drift_audit.md` already flagged — unchanged since that audit.
- **Can receive new features?** No — should be frozen pending `TOOL-REGISTRY-BRIDGE-001`.
- **Can be deleted later?** Yes, once `AgentRuntime`'s tool-call site is rebridged to `ToolSchedulerRepository`.

### 2. Tool Scheduler

- **Classification: FOUNDATION ONLY**
- **Current owner**: `tool_scheduler_runtime.rs` (`ToolSchedulerRuntime`).
- **Production callers**: none. Zero HTTP route, zero `AppState` wiring, zero caller outside its own test module.
- **Repository owner**: `storage/repositories/tool_scheduler.rs` (`ToolSchedulerRepository`), which it holds and delegates persistence to.
- **Current dependencies**: `ToolSchedulerRepository`.
- **Current execution path**: `submit_invocation` → validates request → evaluates permission → if tool name is literally `"runtime.noop"` and `auto_complete_noop` is set, calls `complete_noop()` (a state transition, not real execution); any other tool name is rejected before reaching an execution step at all.
- **Current lifecycle**: `Requested → Queued/AwaitingApproval → Running → Completed|Failed|Cancelled|TimedOut|Denied|Skipped` — fully modeled, all transitions are metadata-only.
- **Persistence**: full — every transition is a real SQLite write through `ToolSchedulerRepository`.
- **Remaining work**: an actual execution loop/dispatcher that can route a non-noop, permitted invocation to a real adapter; production wiring into `AppState`/an HTTP route or the `AgentRuntime` tool-call site.
- **What is missing**: the entire "do the thing" step. Today this is `ProviderRuntimeService`'s exact architectural pattern (safe lifecycle seam, zero I/O) applied to tools — which is appropriate as a foundation, but it is not an executor and should not be described as one.
- **Drift**: `docs/tool_runtime_registry_drift_audit.md` §3 labels this "Partial" with "lacks execution loop" — this audit confirms that characterization and adds: it is also fully unwired from any caller, which that prior audit did not state explicitly.
- **Can receive new features?** Yes — this is the correct place for future tool-execution work, once an adapter contract exists (see #5).
- **Can be deleted later?** No — this is the intended canonical foundation per `docs/tool_runtime_registry_drift_audit.md` §7, assuming the recommended bridge work lands.

### 3. Tool Scheduler Repository

- **Classification: IMPLEMENTED AND PRODUCTION** (as a persistence layer only — see caveat below)
- **Current owner**: `storage/repositories/tool_scheduler.rs` (2027 lines).
- **Production callers**: **none in the product request path.** "Production" here means production-quality, fully real SQLite CRUD with real migrations (`migrations/0028_tool_scheduler_foundation.sql`) and ~20+ passing persistence tests (`tool_definition_can_be_created_read_and_listed`, `invocation_status_transitions_persist`, `permission_grant_persists_and_revokes`, `artifact_ref_persists_without_content`, and others) — it is not a stub. But no live HTTP request reaches it; its only callers today are `ToolSchedulerRuntime` and `ToolRegistryBridge` (#13), both themselves unwired to any route. This classification describes code quality/completeness, not reachability — see #2 for the reachability gap.
- **Repository owner**: itself.
- **Current dependencies**: SQLite via the shared `Database`/connection pool pattern used by every other repository in the codebase.
- **Current execution path**: n/a — it is a persistence layer, not an execution path.
- **Current lifecycle**: mirrors `ToolSchedulerRuntime`'s state enum at the storage layer (`ToolInvocationStatus`, `ToolInvocationPermissionStatus`).
- **Persistence**: `tool_definitions`, `tool_invocations`, `tool_artifacts`, `tool_permission_grants` tables — all real, all tested, including forbidden-marker rejection tests (`tool_scheduler_tables_do_not_store_raw_payload_columns`, `permission_metadata_rejects_forbidden_markers`).
- **Remaining work**: none at the persistence layer itself; remaining work is entirely upstream (give it real callers).
- **What is missing**: nothing structural — this is the most complete component in the entire Tool Runtime stack.
- **Drift**: none found.
- **Can receive new features?** Yes, if a real adapter/executor needs new artifact kinds or permission scopes.
- **Can be deleted later?** No.

### 4. Tool Runtime

- **Classification: FOUNDATION ONLY**
- This term is ambiguous in the codebase — it could mean `ToolRuntimeBoundary` (`agent_runtime/tools.rs`) or `ToolSchedulerRuntime` (`tool_scheduler_runtime.rs`). Both exist, are unconnected to each other, and are each audited individually (#1/#2 for the registries they sit on top of; this entry covers `ToolRuntimeBoundary` specifically since it's the one with a live production caller).
- **Current owner**: `agent_runtime/tools.rs` (`ToolRuntimeBoundary`).
- **Production callers**: `AgentRuntime::execute_run`, gated experimental route only.
- **Repository owner**: none (delegates to in-memory `ToolRegistry`, #1).
- **Current dependencies**: `ToolRegistry`, `SafeToolArguments` (redaction).
- **Current execution path**: `invoke()` evaluates permission against the registry, then **always** returns a synthesized "not implemented" result — there is no branch in this function that executes anything, even for an allowed tool.
- **Current lifecycle**: `requested → permission-evaluated → skipped` — exactly three states, no `running`/`completed` state is ever reached.
- **Persistence**: none.
- **Remaining work**: superseded by #2's bridge, same as #1.
- **What is missing**: any execution branch at all.
- **Drift**: duplicate concept with `ToolSchedulerRuntime` (#2) — both are "tool runtime" by name, doing the same conceptual job (lifecycle + permission gating) with zero awareness of each other.
- **Can receive new features?** No.
- **Can be deleted later?** Yes, same condition as #1.

### 5. Tool Runtime Adapter Contract

- **Classification: NOT STARTED**
- **Current owner**: none.
- **Production callers**: none.
- **Repository owner**: n/a.
- **Current dependencies**: n/a.
- **Current execution path**: n/a — there is no contract type, trait, or interface anywhere in `services/loom-service/src/` that an adapter would implement. `ToolSchedulerRuntime`'s own file header explicitly disclaims doing this ("It intentionally does not execute shell, filesystem, network, MCP, provider, or arbitrary tool logic").
- **Current lifecycle**: n/a.
- **Persistence**: n/a.
- **Remaining work**: design + implement a trait (e.g. `ToolAdapter`) that `ToolSchedulerRuntime` could dispatch a permitted, non-noop invocation to, analogous to how `ProviderAdapter` (`providers/adapter.rs`) lets `ProviderPipeline` stay provider-agnostic.
- **What is missing**: everything — this is the single largest gap in the whole stack, and the literal prerequisite for #15–22 (every adapter).
- **Drift**: none to report — there's no implementation to drift from a design, because no design-level trait exists in code (only prose in `docs/loom_v1_v2_boundary_audit.md` §6 describing the tool/context boundary conceptually, not a contract).
- **Can receive new features?** N/A — this *is* the feature to build.
- **Can be deleted later?** N/A.

### 6. Tool Execution

- **Classification: NOT STARTED**
- Every path that could execute a tool (`ToolRuntimeBoundary::invoke`, `ToolSchedulerRuntime::submit_invocation`) terminates in an explicit non-execution result (`Skipped`/"not implemented" or noop-only completion). There is no code anywhere that runs a shell command, makes an HTTP request, reads a file, or calls an MCP server on behalf of a tool. See Critical Questions §3 for the precise termination point.

### 7. Tool Invocation Lifecycle

- **Classification: IMPLEMENTED BUT DISCONNECTED** (in the scheduler stack) / **FOUNDATION ONLY** (in the agent_runtime stack) — two separate lifecycle models exist, see #13/#14 for the duplication.
- The scheduler-side lifecycle (`ToolInvocationStatus` in `storage/repositories/tool_scheduler.rs`) is the more complete of the two: `requested → awaiting_approval → approved/denied → running → completed/failed/cancelled/timed_out/skipped`, fully persisted, fully tested. The agent_runtime-side lifecycle (`ToolInvocationStatus` in `agent_runtime/tools.rs` — **a different enum with the same name**) is a strict subset, in-memory only, and never reaches `running`.

### 8. Tool Permissions

- **Classification: PARTIALLY IMPLEMENTED**
- Two permission models exist: `ToolPermissionRequirement` (`agent_runtime/tool_registry.rs`, in-memory, `AlwaysAllowed`/`DenyByDefault`-style) and `ToolPermissionScope` + `ToolPermissionGrantRecord` (`storage/repositories/tool_scheduler.rs`, SQLite-backed, supports run-scoped/session-scoped/workspace-scoped grants with expiry and revocation — confirmed by tests `granted_run_scope_authorizes_same_run_only`, `denied_revoked_and_expired_grants_do_not_authorize`). The scheduler-side model is materially more capable (scoped grants, revocation, expiry) but, per #2/#7, has no real invocation to gate yet — it's a complete permission system protecting nothing.

### 9. Tool Artifacts

- **Classification: FOUNDATION ONLY**
- `storage/repositories/tool_scheduler.rs`'s `tool_artifacts` table and `ToolArtifactRecord` are fully implemented (content-free references: `artifact_kind`, `storage_ref`, `visibility`, `content_digest`, `size_bytes` — confirmed by `artifact_ref_persists_without_content`). Nothing creates a real artifact today because nothing executes a tool that would produce one; the only artifact-shaped thing in the live `AgentRuntime::execute_run` path is the hardcoded `ArtifactPlaceholder` step, which creates a fake `artifact_id: "dummy_placeholder_artifact"` with no backing row in this table at all — confirming the placeholder step and the real artifact table are *also* disconnected from each other, not just from execution.

### 10. Tool Events

- **Classification: FOUNDATION ONLY**
- `agent_runtime/events.rs`'s `AgentEvent` enum includes `ToolCallRequested`, `ToolCallSkipped`, `ToolCallCompleted`, `ToolCallFailed` — the full shape exists and is durable-event-safe (sanitized payloads only, per `event_to_safe_record`). But only `ToolCallRequested`→`ToolCallSkipped` is ever actually emitted in the current `AgentRuntime::execute_run` flow; `ToolCallCompleted`/`ToolCallFailed` are defined but unreachable dead branches in practice, since nothing ever runs to completion or failure.

### 11. Tool Result Handling

- **Classification: NOT STARTED**
- There is no code path where a tool's output becomes part of a subsequent provider request. `execute_run`'s placeholder tool step does not append anything to `provider_messages` and does not trigger a second provider call — the architecture is strictly single-turn (one `ContextBuild` → one `ProviderCall` → done). See Critical Question §9 for the literal current answer ("it doesn't").

### 12. Tool Context Injection

- **Classification: NOT STARTED**
- The only trace of this concept anywhere in the codebase is the string `"raw_tool_output"` inside `context_selection.rs`'s forbidden-marker list (a privacy guard anticipating a future source type, not a working injection path) and `ToolMcpContext` as an explicitly reserved, never-populated tier (tier 11) in the Context Selection 11-tier model. No code reads a `ToolResult`/`ToolArtifact` and turns it into a `ContextCandidate`.

### 13. Tool Registry Bridge

- **Classification: PARTIALLY IMPLEMENTED, DISCONNECTED**
- `ToolRegistryBridge` (inside `agent_runtime/tool_registry.rs`) exists and does exactly one real thing: seed the SQLite `tool_definitions` table from the 4 catalog descriptors. It does not bridge *invocation routing* — `AgentRuntime`'s actual tool-call site (#4) still goes through the old in-memory registry, never through this bridge or the scheduler it seeds. "Bridge" here is a one-way, write-only data sync, not a routing bridge.

### 14. Tool Scheduler Bridge

- **Classification: NOT STARTED**
- No code connects `AgentRuntime::execute_run`'s tool-call site to `ToolSchedulerRuntime`. This is the literal `TOOL-REGISTRY-BRIDGE-001` task `docs/tool_runtime_registry_drift_audit.md` recommends and which remains entirely unactioned — confirmed unchanged by this audit's independent grep (zero references to `ToolSchedulerRuntime` anywhere in `agent_runtime/`).

### 15–20. Tool Adapter Layer / File / Web / OCR / Shell / MCP Adapters

- **Classification (all six): NOT STARTED.**
- No `ToolAdapter` trait exists (#5), and consequently no file, web, shell, or MCP adapter implementation exists either, anywhere in `services/loom-service/src/`. (Verified by exhaustive case-insensitive search for `FileAdapter`/`WebAdapter`/`ShellAdapter`/`McpAdapter`/`OcrAdapter` — zero matches.)
- **Important disambiguation on "OCR Adapter":** Loom already has a real, production OCR pipeline — `storage/repositories/attachments.rs`'s Tesseract-based scanned-PDF OCR, config-gated via `config.rs`'s `[ocr]` section. **This is completely unrelated to a Tool-Runtime "OCR Adapter."** The existing OCR pipeline is part of the Attachment/Knowledge-Layer ingestion flow (parsing a user-uploaded file), not a tool an agent invokes mid-run. Do not conflate the two when scoping future work — a Tool-Runtime OCR Adapter, if ever built, would be a thin wrapper that lets an agent *invoke* this existing capability on demand, not a new OCR implementation.
- Owner/callers/dependencies/lifecycle/persistence: all n/a — there is nothing to describe.
- **What is missing for all six**: the adapter contract itself (#5) is the hard blocker; once it exists, each adapter is independent, scoped implementation work.

### 21. MCP Runtime

- **Classification: NOT STARTED**
- No module, no contract, no client. "MCP" appears in source only as the reserved `ToolMcpContext` Context Selection tier name and in scattered doc-comment prose describing future scope (`docs/agent_runtime_contracts.md` §3: "Loom-native, MCP, and future external Tools" use "the same invocation contract" — a normative *intention*, not implemented code).

### 22. MCP Boundary

- **Classification: NOT STARTED**
- Same finding as #21 — there is no boundary to audit because there is no implementation on either side of it.

### 23. SubAgent Tool Execution

- **Classification: NOT STARTED**
- Depends transitively on SubAgent Execution generally (audited in `docs/runtime_architecture_state_audit.md` §1 #18 as NOT STARTED) and on Tool Execution itself (#6, NOT STARTED). There is no code where a child `AgentRun` requests a tool, and no code where any `AgentRun` (parent or child) successfully executes one.

### 24. Capability Integration

- **Classification: NOT STARTED** (with respect to tool-calling) — **IMPLEMENTED AND PRODUCTION** (with respect to its actual, unrelated purpose).
- Re-confirming `docs/runtime_architecture_state_audit.md` §2 item #20's disambiguation: `capabilities/*.rs` is the LLM model/execution-strategy capability system (`ExecutionStrategy`, model benchmarks, hardware compatibility estimates), used in production by `orchestration.rs`'s `resolve_execution_strategy()`. It has zero integration with tool-calling capability — no code path connects a tool's required permissions/trust level to this module's strategy resolution, and none should be assumed from the shared word "capability."

---

## 2. Critical Questions

### 1. Can AgentRuntime execute a real tool today? If yes, how. If no, where does it terminate?

**No.** `AgentRuntime::execute_run` (`agent_runtime/runtime.rs`) runs a hardcoded `ToolInvocationRequest` for `tool_name: "dummy_placeholder_tool"` against `ToolRuntimeBoundary::invoke()`. That function evaluates permission against the in-memory `ToolRegistry` (seeded with 4 descriptors, all `ToolAvailability::NotAvailable`) and **unconditionally** returns a synthesized result with `ToolInvocationStatus::Skipped` and error code `TOOL_EXECUTION_NOT_IMPLEMENTED` — there is no code branch inside `invoke()` that would execute anything even if a tool were marked available. Execution terminates at `ToolRuntimeBoundary::invoke()`'s return statement; nothing downstream of it (no adapter, no process spawn, no network call) is ever reached.

### 2. Can ToolScheduler execute a real tool today?

**No, except the literal built-in noop.** `ToolSchedulerRuntime::submit_invocation` checks the requested tool name; if it is exactly `"runtime.noop"` and `auto_complete_noop` is requested, it transitions straight to `Completed` with no actual work performed. Any other tool name causes the request to be rejected before reaching a running state at all — confirmed by the file's own header comment disclaiming shell/filesystem/network/MCP/provider execution.

### 3. Can ToolRuntime execute anything except noop?

**No.** Whether "ToolRuntime" means `ToolRuntimeBoundary` (always returns not-implemented, #1 above) or `ToolSchedulerRuntime` (noop-only, #2 above), the answer is the same: nothing beyond a synthesized non-execution result or a literal no-op completion.

### 4. Does Tool Runtime have a canonical execution pipeline?

**No — there are two non-canonical, mutually unaware pipelines**, audited individually above: the `AgentRuntime → ToolRuntimeBoundary → ToolRegistry` path (reachable, but a dead end) and the unreachable `ToolSchedulerRuntime → ToolSchedulerRepository` path (a complete foundation, but reachable from nothing). Neither is canonical because canonicity requires both completeness and being the single agreed path — neither condition holds for either one alone.

### 5. Are there multiple registries remaining? If yes, identify all.

**Yes, two:**
1. `agent_runtime/tool_registry.rs`'s `ToolRegistry` — in-memory `HashMap`, seeded by `catalog.rs`, the one `AgentRuntime` actually queries.
2. `storage/repositories/tool_scheduler.rs`'s `tool_definitions` table (queried via `ToolSchedulerRepository`) — SQLite-backed, seeded by `ToolRegistryBridge`, queried by nothing in production.

There are also **two separate `ToolInvocationStatus` enums** (one per stack, same name, different variants/meaning) and **two separate `ToolPermissionRequirement`-shaped concepts** (#8) — these are not registries per se but are the same duplication pattern extended to adjacent types, worth tracking alongside the registry count.

### 6. Is Adapter Contract already implemented, or only partially?

**Not implemented at all — 0%, not partial.** There is no trait, interface, or even a documented Rust type signature for what an adapter would look like. The closest artifact is prose in `docs/loom_v1_v2_boundary_audit.md` §6 distinguishing "passive context" from "active tool operations" conceptually — useful for scoping, but not a contract a developer could implement against.

### 7. What exactly is missing before File/Web/OCR adapters can be written?

In strict dependency order:
1. The Tool Runtime Adapter Contract itself (#5/#6) — a trait describing how an adapter receives a sanitized invocation and returns a `ToolResult`-shaped outcome.
2. A decision on which stack owns dispatch — `ToolSchedulerRuntime` (recommended, since it already has the complete lifecycle/permission/artifact foundation) or a new mechanism layered onto `ToolRuntimeBoundary` (not recommended, since that stack is slated for retirement per `docs/tool_runtime_registry_drift_audit.md` §8).
3. The Tool Scheduler Bridge (#14) — without it, even a fully-built adapter has no live invocation ever reaching it, since `AgentRuntime` doesn't call into the scheduler stack at all today.
4. Tool Result Handling (#11) and Tool Context Injection (#12) — an adapter that executes successfully but whose result never reaches the model or the context is a no-op from the user's perspective; these need to exist before an adapter is *useful*, even though they could technically be built after.

Only after all four exist does writing the specific File/Web/OCR adapter logic itself become the remaining work — and at that point each is independent, low-risk, scoped implementation.

### 8. If someone started implementing MCP tomorrow, would they just write an MCP Adapter, or is foundational work still missing?

**Foundational work is still missing — writing "just an MCP Adapter" is not possible yet.** MCP would need the same four prerequisites listed in Critical Question 7 as any other adapter (there is nothing MCP-specific that's closer to done — it has exactly the same zero-foundation status as File/Web/Shell). Treating MCP as special-cased or further along than the other adapters would be a mistake; `docs/agent_runtime_contracts.md` §8's normative language ("Loom-native and MCP Tools use separate namespaces but the same invocation contract") describes an intended *parity*, not a head start.

### 9. How does a Tool result flow back into the model? Describe the CURRENT implementation, not the intended architecture.

**It doesn't — there is no current implementation of this at all.** `AgentRuntime::execute_run`'s sequence is strictly: one `ContextBuild` step, one `ProviderCall` step (a single, complete provider exchange with deltas streamed and a terminal `ProviderCompleted` event), then the placeholder `ToolCallPlaceholder` step (which is evaluated and skipped *after* the provider call has already finished, not before or interleaved with it), then `ArtifactPlaceholder`, then `ValidationPlaceholder`, then `RunCompleted`. There is no second `ProviderCall` step, no mechanism to re-enter the provider step with new messages appended, and no code that would construct a "tool result" message in any provider-contract shape. The current implementation is not "tool result handling that's incomplete" — it is the complete absence of a multi-turn loop of any kind. (`docs/agent_runtime_event_model.md` §4's documented event flow already shows tool/subagent flows as optional bracketed segments *after* the provider step completes, consistent with what's actually implemented — the design and the code agree here that today's loop is single-turn; what's missing is everything needed to make a *second* turn happen at all.)

### 10. Describe the ACTUAL execution pipeline today. Show exactly where it stops.

```
Agent  (AgentRuntime::execute_run, gated experimental route only)
  ↓
ContextBuild step  (legacy ContextManager, if legacy_context supplied — real, works)
  ↓
ProviderCall step  (ProviderRuntimeService lifecycle + real ProviderPipeline::stream_chat — real, works, this session's bridge)
  ↓
[ run.completed for the conversational turn — this part of the pipeline is genuinely functional end-to-end ]
  ↓
ToolCallPlaceholder step  (runs AFTER the provider call, not interleaved with it)
  ↓
ToolRuntimeBoundary::invoke(hardcoded "dummy_placeholder_tool")
  ↓
ToolRegistry lookup  → tool not available
  ↓
■■■ STOPS HERE ■■■  — ToolCallSkipped event emitted, TOOL_EXECUTION_NOT_IMPLEMENTED
  ✗
Tool  — never reached (no real tool name is ever attempted, the call is hardcoded to a known-unavailable placeholder)
  ✗
Adapter / MCP / External system — no code exists to reach
  ✗
Tool result → LLM — no code exists to do this (Critical Question 9)
```

The conversational half of the pipeline (Agent → Context → Provider → LLM) is real and working. The tool half (→ Tool → Adapter → result-back-to-LLM) does not exist past a single hardcoded lookup that is designed to fail.

---

## 3. Implementation Inventory

| Feature | Status | Production? | Blocked By | Next Task |
|---|---|---|---|---|
| Tool Registry (in-memory) | FOUNDATION ONLY | Reachable (experimental route), not useful | — | Retire after #Tool Scheduler Bridge |
| Tool Registry (SQLite `tool_definitions`) | FOUNDATION ONLY | No | — | `TOOL-REGISTRY-BRIDGE-001` |
| Tool Runtime (`ToolRuntimeBoundary`) | FOUNDATION ONLY | Reachable, not useful | — | Retire after bridge |
| Tool Scheduler (`ToolSchedulerRuntime`) | FOUNDATION ONLY | No | Adapter Contract | `TOOL-RUNTIME-ADAPTER-CONTRACT-001` |
| Tool Scheduler Repository | IMPLEMENTED AND PRODUCTION (as code, not as a live path) | No live caller | — | none — already complete |
| Permission Model (in-memory) | FOUNDATION ONLY | Reachable, gates nothing real | — | Retire after bridge |
| Permission Model (SQLite scoped grants) | PARTIALLY IMPLEMENTED | No | Tool Scheduler Bridge | `TOOL-SCHEDULER-BRIDGE-001` |
| Artifact Lifecycle (table) | FOUNDATION ONLY | No | Tool Execution | same as above |
| Artifact Lifecycle (placeholder step) | LEGACY ONLY / disconnected from the real table | Reachable, fake | — | retire placeholder once real artifacts exist |
| Tool Events | FOUNDATION ONLY | Partially reachable (`Requested`/`Skipped` only) | Tool Execution | — |
| Adapter Contract | NOT STARTED | No | — | `TOOL-RUNTIME-ADAPTER-CONTRACT-001` (first task, blocks everything below) |
| Tool Execution (generic) | NOT STARTED | No | Adapter Contract, Tool Scheduler Bridge | — |
| Tool Result Handling | NOT STARTED | No | Tool Execution | `TOOL-RESULT-CONTEXT-LOOP-001` |
| Tool Context Injection | NOT STARTED | No | Tool Result Handling | same |
| File Adapter | NOT STARTED | No | Adapter Contract | after contract lands |
| Web Adapter | NOT STARTED | No | Adapter Contract | after contract lands |
| OCR Adapter (tool-invocable wrapper) | NOT STARTED | No | Adapter Contract | after contract lands; reuse existing attachment OCR pipeline as the underlying capability |
| Shell Adapter | NOT STARTED | No | Adapter Contract | after contract lands; highest scrutiny given sandboxing risk |
| MCP Adapter | NOT STARTED | No | Adapter Contract | no special priority over File/Web/Shell — see Critical Question 8 |
| SubAgent Tool Execution | NOT STARTED | No | SubAgent Execution generally, Tool Execution | out of scope until both prerequisites exist |
| Capability Integration (tool-calling sense) | NOT STARTED | No | n/a — not yet scoped as a real feature | define what this would even mean before tasking it |

---

## 4. Technical Debt

**Dead code:**
- `AgentRuntime::execute_run`'s `ToolCallPlaceholder`/`ArtifactPlaceholder`/`ValidationPlaceholder` steps produce events and repository rows for phases that do nothing — not "dead" in the sense of unreachable, but dead in the sense of contributing zero functional value per execution while still costing a repository write each.

**Disconnected code:**
- `ToolSchedulerRuntime` + `ToolSchedulerRepository` — fully built, zero callers.
- `ContextSelectionService`/`AgentContextManager` (carried over from `docs/runtime_architecture_state_audit.md`, restated here because it's directly relevant to #12 — Tool Context Injection would need to land *inside* whichever context pipeline becomes canonical, and today both context pipelines exist with neither one being a clean place to add tool-output handling).

**Duplicate concepts:**
- Two `ToolInvocationStatus` enums (`agent_runtime/tools.rs` vs. `storage/repositories/tool_scheduler.rs`), same name, different shape.
- Two permission models (`ToolPermissionRequirement` in-memory vs. `ToolPermissionScope`/`ToolPermissionGrantRecord` SQLite-backed).
- Two tool registries (#5 above).
- Two artifact concepts (the real `tool_artifacts` table vs. the fake placeholder `artifact_id` string in `execute_run`).

**Temporary compatibility layers:**
- `ToolRegistryBridge`'s one-way seed-only sync is exactly this — a stopgap that makes the SQLite side aware of the in-memory side's 4 descriptors without making either side aware of the other's *invocations*.

**Future deletion candidates** (gated on their replacement landing first, per the same caveat in `docs/runtime_architecture_state_audit.md` §4):
1. `agent_runtime/tool_registry.rs` (`ToolRegistry`) — once `TOOL-SCHEDULER-BRIDGE-001` routes `AgentRuntime` through `ToolSchedulerRuntime`.
2. The in-memory `ToolPermissionRequirement` model in the same file — same condition.
3. `ToolRuntimeBoundary`'s always-skip `invoke()` — same condition.
4. The `ToolCallPlaceholder`/`ArtifactPlaceholder`/`ValidationPlaceholder` steps in `execute_run` — once real tool execution and artifact creation exist, these placeholders should be replaced by the real steps, not kept alongside them.

---

## 5. Recommended Engineering Tasks, In Dependency Order

This recommendation is derived solely from the code-level gaps found above, independent of the existing roadmap's framing or percentages.

1. **`TOOL-RUNTIME-ADAPTER-CONTRACT-001`** — define the `ToolAdapter` trait (or equivalent dispatch mechanism) that `ToolSchedulerRuntime` can call for a permitted, non-noop invocation. This is the single hardest blocker; nothing else in this list can start before it.
2. **`TOOL-SCHEDULER-BRIDGE-001`** — connect `AgentRuntime::execute_run`'s tool-call site to `ToolSchedulerRuntime`/`ToolSchedulerRepository` instead of the in-memory `ToolRegistry`/`ToolRuntimeBoundary`. This single task resolves the dual-registry, dual-lifecycle, dual-permission-model duplication (#5 above) in one move, since it makes the SQLite-backed stack the only one with a live caller.
3. **`TOOL-REGISTRY-RETIREMENT-001`** — once #2 lands and is stable, delete `agent_runtime/tool_registry.rs`'s `ToolRegistry`/`ToolPermissionRequirement` and `ToolRuntimeBoundary`'s always-skip path, per the deletion candidates in §4.
4. **`TOOL-RESULT-CONTEXT-LOOP-001`** — design (not yet implement) how a completed `ToolResult`/`ToolArtifact` becomes a second provider turn: what triggers re-entering `ProviderCall`, what message shape the result takes, and where the loop terminates (max tool calls per run, etc.). This is required before any adapter is *useful*, even though it can be designed in parallel with #1–3.
5. **`TOOL-CONTEXT-INJECTION-DESIGN-001`** — design how a verified `ToolArtifact` becomes an eligible Context Selection source (the reserved `ToolMcpContext` tier, or a new dedicated tier) without violating the identity-only candidate boundary the rest of Context Selection already enforces. Depends on #4's loop design existing first, since context injection is the "make it visible to future turns" half of what #4 makes happen for "the current turn."
6. **`FIRST-TOOL-ADAPTER-IMPLEMENTATION-001`** (a single, deliberately narrow adapter — recommend a read-only, low-risk one like a File Adapter limited to already-attached files, reusing the existing attachment pipeline rather than arbitrary filesystem access) — the first real end-to-end proof that #1–5 actually compose into a working tool call.
7. **`SECOND-TOOL-ADAPTER-IMPLEMENTATION-001`** (Web Adapter, read-only, with explicit network-egress policy review) — validate that #1's contract generalizes beyond the first adapter's shape before investing in more.
8. **`SHELL-ADAPTER-DESIGN-REVIEW-001`** — a dedicated security design review before any Shell Adapter implementation, given the sandboxing/credential-exposure risk class; do not implement directly from #1's generic contract without this extra gate.
9. **`MCP-ADAPTER-IMPLEMENTATION-001`** — only after at least one non-MCP adapter (#6/#7) has proven the contract; per Critical Question 8, MCP has no implementation head start and should not be scheduled earlier than this position.
10. **`ARTIFACT-PLACEHOLDER-RETIREMENT-001`** — replace `execute_run`'s fake `ArtifactPlaceholder`/`ValidationPlaceholder` steps with real ones backed by the now-live `tool_artifacts` table, closing the dead-code gap identified in §4.

---

## 6. Files Created

- `docs/tool_runtime_implementation_state_audit.md` (this document).
