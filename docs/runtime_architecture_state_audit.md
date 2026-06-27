# Runtime Architecture State Audit v1.0

Status: AUDIT COMPLETE — documentation only, no source code modified
Task: `RUNTIME-ARCHITECTURE-STATE-AUDIT-001`

## 0. Purpose and Method

This document determines the *actual* implementation state of Loom's V2 runtime stack directly from source code, because the roadmap (`docs/loom_master_roadmap.md`) and several prior audit docs have drifted from reality multiple times this session (see `docs/loom_master_roadmap.md` §5, `docs/tool_runtime_registry_drift_audit.md`). Every claim below is grounded in a file read or grep against `services/loom-service/src/` performed for this audit, not inferred from prose elsewhere. Where this document disagrees with a prior doc or the roadmap, this document is the more recent, code-grounded source — but it does not silently overwrite the roadmap; see §4.

No source code was modified, refactored, or deleted in producing this document.

---

## 1. Implementation Matrix

| # | Component | State | Owner | Production Caller | Key Dependencies |
|---|---|---|---|---|---|
| 1 | Tool Runtime Adapter Contract | **NOT STARTED** | — | none | n/a — no adapter contract exists; `ToolSchedulerRuntime`'s own header says it intentionally executes nothing beyond a built-in noop |
| 2 | Tool Scheduler Runtime | **IMPLEMENTED BUT DISCONNECTED** | `tool_scheduler_runtime.rs` | none | `storage/repositories/tool_scheduler.rs` |
| 3 | Tool Registry Bridge | **PARTIALLY IMPLEMENTED, DISCONNECTED** | `agent_runtime/tool_registry.rs` (`ToolRegistryBridge`) | none | seeds `tool_scheduler.rs` repository only; not wired to `AppState` |
| 4 | Provider Runtime | **IMPLEMENTED AND IN PRODUCTION PATH** | `provider_runtime.rs` | `AgentRuntime::execute_run`, `MainGenerationAgentRunShim` (orchestration.rs) | none (deliberately, by static guard) |
| 5 | Provider Runtime Bridge | **IMPLEMENTED AND IN PRODUCTION PATH** | `agent_runtime/runtime.rs`, `api/orchestration.rs` | Main Generation (every request), experimental AgentRuntime route | `provider_runtime.rs`, `providers/pipeline.rs` |
| 6 | AgentRun (concept/table) | **SPLIT — see note** | `storage/repositories/agent_runs.rs` | Main Generation (audit rows only); experimental route (full state machine) | SQLite `agent_runs`/`agent_steps`/`agent_events` |
| 7 | Main Generation AgentRun Shim | **IMPLEMENTED AND IN PRODUCTION PATH** | `api/orchestration.rs` (`MainGenerationAgentRunShim`) | every `/orchestration/execute` call | `AgentRunRepository`, `ProviderRuntimeService` |
| 8 | Quick Ask AgentRun | **NOT STARTED** | — | none | design exists (`docs/quick_ask_agentrun_design.md`); zero code |
| 9 | Context Pipeline (Knowledge Layer, umbrella) | **SPLIT — see note** | varies by sub-component | Main Generation uses the legacy half only | see #10–12 |
| 10 | Legacy ContextManager | **IMPLEMENTED AND IN PRODUCTION PATH** | `context/manager.rs` | `api/orchestration.rs` (every Main Generation request) | `context/contributors.rs`, `storage/repositories/context_artifacts.rs`, `attachments.rs`, `memory.rs`, `references.rs` |
| 11 | AgentContextManager | **IMPLEMENTED BUT DISCONNECTED** | `agent_context_manager.rs` | none in production; only its own + `context_selection.rs`'s test suites | `context_selection.rs` output, `storage/repositories/context_snapshots.rs` |
| 12 | ContextSelectionService | **IMPLEMENTED BUT DISCONNECTED** | `context_selection.rs` | none in production | `retrieval/hybrid_service.rs`, `scope_resolution.rs`, `memory.rs` |
| 13 | ProviderPipeline | **IMPLEMENTED AND IN PRODUCTION PATH** | `providers/pipeline.rs` | Main Generation, Quick Ask, `AgentRuntime::execute_run` | `providers/adapter.rs`, provider-specific adapters (`ollama.rs`, `openai.rs`, etc.) |
| 14 | Tool Execution | **NOT STARTED** | — | none | every path that reaches a tool-call site (`ToolRuntimeBoundary::invoke`, `ToolSchedulerRuntime::submit_invocation`) terminates in an explicit "not implemented" / `Skipped` result; no executor exists anywhere |
| 15 | Tool Adapters | **NOT STARTED** | — | none | none exist; no shell/filesystem/network/MCP adapter code anywhere in `services/loom-service/src/` |
| 16 | MCP Runtime | **NOT STARTED** | — | none | no module exists; only reserved enum variants/comments (e.g. `ToolMcpContext` reserved tier in `context_selection.rs`) reference "MCP" as a future concept |
| 17 | MCP Boundary | **NOT STARTED** | — | none | same as #16 — no boundary/contract code exists to audit |
| 18 | SubAgent Execution | **NOT STARTED** | — | none | only identity-shape placeholders (`parent_run_id`, `root_run_id`, `delegation_id` fields in `agent_runtime/types.rs` and `docs/agent_runtime_contracts.md` §6) — no delegation/spawn execution logic exists |
| 19 | Multi-Agent Execution | **NOT STARTED** | — | none | P20's four design tasks (`MODEL-EXECUTION-TOPOLOGY-DESIGN-001` etc.) are marked done in the roadmap as *design* outputs; no corresponding implementation code was found anywhere in `services/loom-service/src/` |
| 20 | Capability System | **IMPLEMENTED AND IN PRODUCTION PATH** | `capabilities/*.rs` | `api/orchestration.rs` (`resolve_execution_strategy`, benchmark recording) | `storage/repositories` (benchmark/catalog tables) — **unrelated to tool-calling capability**; this is LLM model/execution-strategy capability only |

**Note on #6/#9 (split rows):** these aren't single components with one state — they're umbrella concepts whose sub-parts genuinely diverge, which is itself a finding (see §3).

---

## 2. Per-Component Detail

### 1–3. Tool Runtime Adapter Contract / Tool Scheduler Runtime / Tool Registry Bridge

These three are the most actionable findings of this audit because they directly contradict the optimistic framing in `docs/tool_runtime_registry_drift_audit.md` §3 ("Tool Scheduler Schema: ... fully implemented") by conflating *schema completeness* with *system completeness*.

- **Tool Scheduler Runtime** (`tool_scheduler_runtime.rs`): a metadata/lifecycle seam structurally identical in spirit to `provider_runtime.rs` — `submit_invocation`, `start_invocation`, `cancel_invocation`, `timeout_invocation` all transition state with no I/O. Its one executable behavior is a hardcoded `"runtime.noop"` tool that completes immediately; any other tool name is explicitly rejected before execution is even attempted. Its own file header states it "intentionally does not execute shell, filesystem, network, MCP, provider, or arbitrary tool logic."
- **Tool Scheduler Storage** (`storage/repositories/tool_scheduler.rs`, 2027 lines): this part genuinely is fully implemented — real SQLite CRUD for `tool_definitions`, `tool_invocations`, `tool_artifacts`, `tool_permission_grants`, with ~20+ passing persistence tests. But "the schema and its repository are real" is a different claim than "the tool scheduler is implemented," and the drift audit's phrasing blurred that line.
- **Tool Registry Bridge** (`ToolRegistryBridge` inside `agent_runtime/tool_registry.rs`): exists and does one real thing — seeds the SQLite `tool_definitions` table from the 4 catalog descriptors. It does not bridge *invocation routing* (the actual point of a "bridge" per `docs/tool_runtime_registry_drift_audit.md` §9's `TOOL-REGISTRY-BRIDGE-001` recommendation) — `AgentRuntime::execute_run`'s tool-call site still goes through the old in-memory `ToolRegistry`/`ToolRuntimeBoundary`, never through `ToolSchedulerRuntime` or this bridge.
- **Production wiring**: none of `ToolSchedulerRuntime`, `ToolSchedulerRepository`, or `ToolRegistryBridge` are constructed in `main.rs`/`api/state.rs`/`AppState`. They exist, compile, and pass their own tests, fully isolated from any HTTP route.

**Net effect**: there are two entirely separate, unconnected tool subsystems in the codebase today — an old in-memory one (`ToolRegistry`/`ToolRuntimeBoundary`, reachable from the experimental AgentRun route) and a new SQLite-backed one (`ToolSchedulerRuntime`/`tool_scheduler.rs`, reachable from nothing). Both terminate every real tool-call attempt in an explicit "not implemented" result.

### 4–5. Provider Runtime / Provider Runtime Bridge

Both **IMPLEMENTED AND IN PRODUCTION PATH** as of this session's `PROVIDER-RUNTIME-BRIDGE-001` work. `ProviderRuntimeService` (`provider_runtime.rs`) remains deliberately I/O-free (enforced by its own `provider_runtime_static_guard_no_real_execution` test, which forbids `ProviderPipeline`/`ProviderRegistry`/socket symbols anywhere in the file, including comments) and is now driven by both `AgentRuntime::execute_run` and `MainGenerationAgentRunShim` around their own real, unchanged `ProviderPipeline::stream_chat` calls. This is the one part of the V2 stack that went from "disconnected" to "in production path" within this session — confirm against `_PM/Agent-PM/Tasks/Task_PROVIDER-RUNTIME-BRIDGE-001_v1.0.md` for the validation record.

### 6–8. AgentRun / Main Generation AgentRun Shim / Quick Ask AgentRun

- **AgentRun the *audit record*** (a row in `agent_runs`/`agent_steps`/`agent_events`) is in production — every Main Generation request creates one via `MainGenerationAgentRunShim`, with a context-build step, a provider-call step, and a terminal event, mirroring `ProviderRuntimeService`'s lifecycle (per `PROVIDER-RUNTIME-BRIDGE-001`).
- **AgentRun the *execution engine*** (`AgentRuntime::execute_run`'s full event-sourced state machine — context/provider/tool/artifact/validation steps, `AgentEvent` stream, cancellation signal) is real and tested, but reachable *only* through the gated experimental route (`LOOM_EXPERIMENTAL_AGENT_RUNTIME_API=1`, `POST /experimental/agent/run`). Main Generation does **not** call it — confirmed by the existing `test_product_paths_do_not_call_agent_runtime` guard test in `agent_runtime/service.rs`, which asserts `orchestration.rs`/`ask.rs` never reference `AgentRuntimeService`/`execute_run`/`agent_runtime()`.
- **Quick Ask AgentRun**: zero code. `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001` (this session, prior task) produced a design document only (`docs/quick_ask_agentrun_design.md`); no `QuickAskAgentRunShim` or `AgentRunMode` enum exists yet.

This is the clearest example in the whole audit of "the roadmap says LOCKED, the code says partial": `docs/loom_master_roadmap.md` §2/§3 marks P21 ("V1/V2 Boundary & AgentRun Shim Integration") at 90% ACTIVE — which is roughly accurate for the *shim* (#7, genuinely done) but would overstate things if read as "AgentRun integration" generally, since the actual state-machine engine (#6's execution half) and Quick Ask (#8) are not integrated at all.

### 9–12. Context Pipeline / Legacy ContextManager / AgentContextManager / ContextSelectionService

This is the second-clearest split finding, already documented in detail in `docs/context_pipeline_flow_audit.md` §2/§6/§7/§8 and re-confirmed here: the legacy `ContextManager` + its 7 `ContextContributor`s is the only context path any real request goes through; `ContextSelectionService` → `AgentContextManager` → Context Snapshot is fully built, privacy-correct, and unit-tested, but has never processed a real request. Nothing has changed on this front since that audit — re-confirmed by grep showing zero new production references to either service.

### 13. ProviderPipeline

**IMPLEMENTED AND IN PRODUCTION PATH**, unambiguously — every generation path (Main Generation, Quick Ask, and the experimental AgentRuntime route) ultimately calls `ProviderPipeline::stream_chat`. This is the one piece of the entire audited stack with no disconnection, no duplication, and no drift.

### 14–17. Tool Execution / Tool Adapters / MCP Runtime / MCP Boundary

All four: **NOT STARTED**, full stop. No executor exists for any tool, built-in or otherwise (#1–3 confirm both tool subsystems terminate in "not implemented"). No adapter for shell/filesystem/network/MCP exists. No MCP module, contract, or boundary file exists anywhere in `services/loom-service/src/` — "MCP" appears only as a reserved enum variant name (`ToolMcpContext`, tier 11 of the Context Selection model, explicitly marked "reserved" and never populated) and in doc prose describing future scope. There is nothing to deprecate or bridge here because there is nothing here.

### 18–19. SubAgent Execution / Multi-Agent Execution

**NOT STARTED**, despite `docs/loom_master_roadmap.md` §3 P20 listing `SUBAGENT-RUNTIME-DESIGN-001` and `MODEL-EXECUTION-TOPOLOGY-DESIGN-001` as `DONE`. Those tasks produced *design* artifacts (consistent with their `-DESIGN-` naming) — `docs/agent_runtime_contracts.md` §6 specifies the `SubAgent`/`DelegationId`/`JoinPolicy` contract shape in full normative detail, but no Rust code implements spawning a child `AgentRun`, no delegation event types are wired into `agent_runtime/events.rs` beyond the contract doc's paper specification, and no orchestration logic exists to manage parent/child relationships. The roadmap's "DONE" status for these P20 design epics is **accurate for design** but should not be read as implementation progress — this is not roadmap drift so much as a naming-precision gap worth flagging (§4).

### 20. Capability System

**IMPLEMENTED AND IN PRODUCTION PATH**, and — important disambiguation — **this has nothing to do with tool-calling capability.** `capabilities/strategy.rs` defines `ExecutionStrategy` (response-shape decisions like `ShortDirect`/`DeepSynthesis`/`Parallel2DraftSynthesize`), and `orchestration.rs` calls `resolve_execution_strategy()` on every request to decide how to shape the LLM call itself (output length, parallelism, synthesis approach) based on model benchmarks and hardware estimates. Anyone reading "Capability system" in a tool-calling context (a reasonable reading given #14's "Tool Execution" sits right next to it in this audit's question list) would be wrong — they are unrelated subsystems that happen to share the word "capability."

---

## 3. Dependency Graphs

### 3.1 Generation Path (Production Today)

```
UI (composer / Quick Ask input)
  ↓
API  (api/orchestration.rs "/orchestration/execute"  |  api/ask.rs "/ask/quick")
  ↓
MainGenerationAgentRunShim  (orchestration.rs only — Quick Ask has no shim, see §1 #8)
  ↓
Legacy ContextManager  (context/manager.rs — Quick Ask skips this entirely, see §1 #10)
  ↓
ProviderRuntimeService  (provider_runtime.rs — lifecycle metadata only, both paths, since PROVIDER-RUNTIME-BRIDGE-001)
  ↓
ProviderPipeline  (providers/pipeline.rs)
  ↓
ProviderAdapter  (providers/ollama.rs, openai.rs, anthropic.rs, gemini.rs, openai_compatible.rs, ...)
  ↓
LLM
```

`AgentRuntime`'s own internal version of this same chain (`ContextBuild` step → `ProviderCall` step → `ProviderPipeline::stream_chat`) is real but only reachable via the gated experimental route — draw it as a **parallel, disconnected branch off "API"**, not a step in the production chain above:

```
API ("/experimental/agent/run", gated by LOOM_EXPERIMENTAL_AGENT_RUNTIME_API)
  ↓
AgentRuntimeService → AgentRuntime::execute_run
  ↓
(LegacyContextRuntimeInput, optional) → legacy ContextManager   [same ContextManager instance type as production, different caller]
  ↓
ProviderRuntimeService → ProviderPipeline → ProviderAdapter → LLM
```

`ContextSelectionService`/`AgentContextManager`/Context Snapshot do not appear in either chain — they are not reachable from any entry point in production or experimental code today; draw them as a fully **disconnected island** next to this graph, not feeding into it.

### 3.2 Tool/Agent Path (Designed, Not Production)

```
Agent  (AgentRuntime::execute_run's ToolCallPlaceholder step — the only thing that runs today)
  ↓
ToolRuntimeBoundary  (agent_runtime/tools.rs)
  ↓
ToolRegistry  (agent_runtime/tool_registry.rs — in-memory, 4 seeded descriptors)
  ↓
[ TERMINATES HERE: "TOOL_EXECUTION_NOT_IMPLEMENTED" / ToolInvocationStatus::Skipped ]
  ✗
Tool Adapter   — NOT STARTED, no code exists
  ✗
MCP   — NOT STARTED, no code exists
  ✗
External Tool   — unreachable
```

The parallel, equally-disconnected SQLite-backed path:

```
(nothing calls this today — no production or experimental entry point)
  ↓
ToolSchedulerRuntime  (tool_scheduler_runtime.rs)
  ↓
ToolSchedulerRepository  (storage/repositories/tool_scheduler.rs — fully real persistence)
  ↓
[ TERMINATES HERE: only "runtime.noop" can complete; any other tool name is rejected before execution ]
  ✗
Tool Adapter / MCP / External Tool — NOT STARTED, no code exists
```

Both arrows marked `✗` represent the same underlying fact stated twice because there are two parallel stacks: **no tool, in either stack, can currently do anything except not-execute.**

---

## 4. Explicit Answers

**What is already production?** ProviderPipeline (#13), Provider Runtime + its bridge (#4–5), Legacy ContextManager (#10), Main Generation's AgentRun audit shim (#7), the Capability/execution-strategy system (#20).

**What is production but legacy?** Legacy `ContextManager` (#10) is simultaneously "in production" and explicitly the thing `docs/context_integration_spec_amendment.md` and `docs/loom_v1_v2_codeboundary_marking.md` already mark for eventual replacement by `ContextSelectionService`/`AgentContextManager` — it is production-critical *and* on a deprecation path at the same time, which is why it's marked `V1_CANONICAL_KNOWLEDGE_LAYER` (canonical, not deprecated) rather than `V1_DEPRECATED_NO_NEW_FEATURES` in the existing source annotations. `api/orchestration.rs` itself (the shim host) is also production-but-legacy in this sense — actively serving all traffic while explicitly marked `V1_SHIM`/`V1_DEPRECATED_NO_NEW_FEATURES` for new feature work.

**What is implemented but disconnected?** `ContextSelectionService` + `AgentContextManager` + Context Snapshot creation (#11–12), `ToolSchedulerRuntime` + its repository (#2), and `AgentRuntime::execute_run`'s full state-machine engine considered as a *production* path rather than an experimental one (#6's execution half) — all fully built, fully tested, zero production traffic.

**What should never receive new features again?** `api/orchestration.rs` and `api/ask.rs`'s existing V1 execution loops — already correctly marked `V1_SHIM`/`V1_DEPRECATED_NO_NEW_FEATURES` per `docs/loom_v1_v2_codeboundary_marking.md`, and this audit found nothing to change about that boundary. Add to that list: `agent_runtime/tool_registry.rs` and the in-memory `ToolRuntimeBoundary` — per `docs/tool_runtime_registry_drift_audit.md`'s own recommendation (§8), which this audit confirms is still correct and still unactioned.

**What code can eventually be deleted?** Nothing should be deleted *yet* — every "disconnected" component here is either a deliberate forward-built seam (`ProviderRuntimeService` before its bridge existed, `ContextSelectionService` before Main Generation cuts over) or duplicate scaffolding pending a real bridge (`agent_runtime/tool_registry.rs` vs. `tool_scheduler.rs`). The concrete deletion candidates, gated on their respective bridge tasks landing first, are: (1) `agent_runtime/tool_registry.rs` and the in-memory `ToolRuntimeBoundary`, once `TOOL-REGISTRY-BRIDGE-001` routes `AgentRuntime` through `ToolSchedulerRuntime` instead; (2) the legacy `ContextManager` + its contributors, once Main Generation is proven safe on `ContextSelectionService`/`AgentContextManager` (per `docs/context_pipeline_flow_audit.md` §9's phased sequence) — this is a multi-step migration, not a near-term deletion.

---

## 5. Recommended Next 10 Engineering Tasks, In Order

1. **`AGENTRUN-CONTEXT-CONSUMPTION-001`** status check / close-out — confirm this is actually done (it appears to be, per `agent_runtime/runtime.rs`'s `legacy_context` field and passing tests) and formally mark it `LOCKED` in the roadmap; this audit found it implemented, contradicting any lingering "design only" framing.
2. **`CONTEXT-PIPELINE-AGENT-INTEGRATION-SPEC-001`** — per `docs/context_pipeline_flow_audit.md` §9 step 1, explicitly decide (and document) that Main Generation's eventual full AgentRun cutover keeps using legacy `ContextManager`, not `ContextSelectionService`, at cutover time — this decision is still not formally locked anywhere.
3. **`QUICK-ASK-AGENTRUN-MODE-001`** — implement the `AgentRunMode` enum and reduced lifecycle from `docs/quick_ask_agentrun_design.md` §7 step 1, unit-tested in isolation, no caller changes yet.
4. **`QUICK-ASK-AGENTRUN-SHIM-001`** — implement `QuickAskAgentRunShim` behind a feature flag, per the design doc's migration step 2, and measure latency before defaulting on.
5. **`TOOL-REGISTRY-BRIDGE-001`** — the already-recommended (per `docs/tool_runtime_registry_drift_audit.md` §9) but unactioned task: route `AgentRuntime`'s tool-call site through `ToolSchedulerRuntime`/`ToolSchedulerRepository` instead of the in-memory `ToolRegistry`, eliminating the duplicate `ToolInvocationRequest`/`ToolInvocationStatus` types this audit reconfirmed still exist in both stacks.
6. **`TOOL-RUNTIME-ADAPTER-CONTRACT-001`** — design (not implement) the first real tool adapter contract (likely a sandboxed local-command adapter, mirroring the existing local-command Speech-to-Text provider pattern for a similarly scoped, low-risk first adapter) — only after #5 gives tools a single home to be adapted into.
7. **`MAIN-GENERATION-CONTEXT-CUTOVER-DESIGN-001`** — design (not implement) the eventual cutover of Main Generation from legacy `ContextManager` to `ContextSelectionService`/`AgentContextManager`, since #11–12 have now sat fully-built-but-unused long enough that the cost of never using them (two context implementations to maintain) is starting to outweigh the migration risk that justified deferring it.
8. **`AGENT-RUNTIME-PRODUCTION-PROMOTION-DESIGN-001`** — design (not implement) what it would take to let Main Generation actually call `AgentRuntimeService::execute` instead of maintaining its own parallel direct-`ProviderPipeline` loop with a bolted-on audit shim — i.e., finally close the gap `docs/context_pipeline_agent_integration_design.md` §5 Phase C/D describe, now that the Provider Runtime Bridge (a stated prerequisite) is done.
9. **`SUBAGENT-EXECUTION-DESIGN-REVIEW-001`** — re-review `docs/agent_runtime_contracts.md` §6 against current code before any subagent implementation starts, since this audit found zero implementation progress despite the design being a year-contract-frozen normative spec; confirm the contract still matches intent before building against it.
10. **`MCP-BOUNDARY-DESIGN-001`** — the first real design pass for MCP, since today it exists only as a reserved enum tier name; this should not be implemented until #5/#6 (tool adapter contract) exist, since MCP is fundamentally one kind of tool adapter, not a parallel system.

---

## 6. Files Created

- `docs/runtime_architecture_state_audit.md` (this document).

## 7. ROADMAP STATUS

**Current Phase**: P20 Multi-Agent Execution Topology
**Current Epic**: V1/V2 Boundary & Provider Bridge Sequencing (still not formally registered as a named epic in `docs/loom_master_roadmap.md` §3 — flagged repeatedly across `docs/context_pipeline_flow_audit.md` and this document; still outstanding)
**Current Task**: `RUNTIME-ARCHITECTURE-STATE-AUDIT-001` — completed this turn, audit only

This audit did not recalculate roadmap percentages — doing so requires reconciling the roadmap's P20/P21 entries against the findings in §1/§4 above (most notably: P21's "AgentRun Shim Integration" at 90% conflates a genuinely-done shim with a not-done state-machine cutover and a not-started Quick Ask integration), which is a roadmap-editing action this document's audit-only scope does not authorize. Recommend a dedicated `ROADMAP-RECONCILIATION-002` pass using this document as input.
