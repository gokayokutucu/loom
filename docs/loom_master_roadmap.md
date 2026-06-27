# Loom Master Roadmap v1.0

## 0. Purpose and Authority

This document is the **single source of truth** for Loom's project roadmap. It supersedes the dual numbering schemes previously used across `docs/loom_service_architecture_ledger.md` (§13 "Service Phases 0–10" and §19 "Agent Phase Roadmap 1A–5"). Those two numbering systems collided — "Phase 4" meant *Provider Runtime* in one and *Memory* in the other — and the Agent Phase section of the ledger had not been updated to reflect work that was actually completed (Scope Resolution, Context Selection, and most of the Memory subsystem all shipped while the ledger still listed them as "deferred").

Going forward:

- This document (`docs/loom_master_roadmap.md`) is the **only** place phase numbers are defined.
- `docs/loom_service_architecture_ledger.md` §13 and §19 are deprecated as roadmap sources. They remain as historical record of *decisions* (library adoption, non-goals, config direction) but no longer own phase/task status. See `docs/ledger_contract.md` for the replacement ledger format, which is *generated from* this roadmap rather than maintained by hand.
- Every future Task/Plan/Test/QA file must reference a Phase ID from the canonical list in §2 below. Do not invent new "Phase N" labels — request a new Phase ID from this document first.

This is a design/planning document. No runtime code, migrations, or ledger files were modified in producing it.

---

## 1. Canonical Phase Naming Rule

A **Phase** is a top-level unit of the roadmap. Phase IDs are global and never reused, in the form `P##`. A Phase has exactly one canonical name. The historical filename prefixes in `_PM/Agent-PM/Plans/` (`Phase1_`, `Phase2_`, `Phase3_`, `Phase4_`, `Phase5_`) are **not** renamed retroactively — they are committed history and stay as-is. The mapping table in §2 is the authoritative cross-reference between old filename prefixes and canonical Phase IDs. Any agent or PM skill resolving "what phase is this file part of" must consult §2, never infer it from the filename prefix alone.

---

## 2. Master Phase List

| Phase ID | Canonical Name | Old Label(s) | Status | Completion % | Depends On | Blocked By |
|---|---|---|---|---|---|---|
| P00 | Architecture Foundations | Service Phase 0–2 | LOCKED | 100% | — | — |
| P01 | TypeScript Engine Boundary & Rust Cutover | Service Phase 1 | LOCKED | 100% | P00 | — |
| P02 | Provider Runtime | Service Phase 4 (filename prefix `Phase4_Provider*`, `Phase4_Native*`) | LOCKED | 93% | P00 | — |
| P03 | Context Pipeline Foundations (legacy) | Service Phase 5 | LOCKED | 100% | P00, P01 | — |
| P04 | Orchestration & Workflow Runtime | Service Phase 6 | LOCKED | 100% | P03 | — |
| P05 | Graph & Addressing | Service Phase 7 | LOCKED | 100% | P00 | — |
| P06 | Export/Import | Service Phase 8 | LOCKED | 100% | P05 | — |
| P07 | Product Surface (Quick Ask / Weft / Reference / Bookmark) | (cross-cutting, no old phase number) | LOCKED | 100% | P03, P04, P05 | — |
| P08 | Electron Shell & Packaging | Service Phase 2 (Electron sub-thread) | LOCKED core / NEXT signing | 90% | P00 | — |
| P09 | Speech-to-Text | (cross-cutting, no old phase number) | LOCKED core / NEXT E2E | 90% | P02 | — |
| P10 | UI Polish (Minimap / Revision Paging / Markdown / Scroll) | Service Phase 1 (filename prefix `Phase1_`, `Phase4_Minimap*` etc.) | ACTIVE (low-grade, ongoing) | 91% | — | — |
| P11 | Tool Runtime & Registry | Agent Phase 1A (filename prefix `Phase5_ToolRuntime*`) | **DRIFT FLAGGED** — see §5 | 67% (disputed) | P12 | — |
| P12 | Agent Runtime Foundation | Agent Phase 1A (filename prefix `Phase5_AgentRuntime*`) | LOCKED | 100% | P00, P01 | — |
| P13 | Agent Run Persistence & Inspector | Agent Phase 1B (filename prefix `Phase5_AgentRun*`) | LOCKED | 100% | P12 | — |
| P14 | Retrieval Architecture | Agent Phase 2A–2F (filename prefix `Phase2_*Retrieval*`, `Phase2_SqliteProjection*`) | LOCKED | 100% | P00 | — |
| P15 | Scope Resolution & Context Selection | Agent Phase 2G (filename prefix `Phase2_ScopeResolution*`, `Phase2_ContextSelection*`) | LOCKED — ledger §19 incorrectly still says "deferred"; see §5 | 100% | P14 | — |
| P16 | Agent Context Manager & Context Snapshot | Agent Phase 3A–3B (filename prefix `Phase3_Context*`) | LOCKED | 100% | P13, P15 | — |
| P17 | Memory Subsystem | Agent Phase 4 (filename prefix `Phase4_Memory*`) | LOCKED | 100% | P15, P16 | — |
| P18 | Agent Behavior | Agent Phase 5 | LOCKED | 100% | P16, P17 | — |
| P19 | Settings IA, Privacy & Data Backlog | Ledger HOLD/BACKLOG block | HOLD-BACKLOG | 0% | P08 | Explicit hold, no blocker — deprioritized |
| P20 | Multi-Agent Execution Topology | New in this rebase | ACTIVE | 30% | P17, P18 | — |
| P21 | V1/V2 Boundary & AgentRun Shim Integration | New for context and execution bridge | ACTIVE | 95% | P12, P16 | — |
| P22 | Execution Engine | New under ROADMAP-EXECUTION-ENGINE-RESTRUCTURE-001 | ACTIVE | ~22% | P12, P16, P20, P21 | — |
| P23 | Planning Architecture | New — split out of historical "Agent Behavior" framing | NOT STARTED | 0% | P22 | — |
| P24 | Behavior Steering | New — split out of historical "Agent Behavior" framing | NOT STARTED | 0% | P18, P22 | — |
Effort estimates (relative, not calendar time) are given per-Epic in §3, not per-Phase, since Phase-level estimates were the original problem (too coarse to act on).

---

## 3. Phase Tree (Phase → Epic → Task → Subtask)

Only Phases with remaining work, disputed status, or structural significance to the rebase are expanded to Task level below. Fully LOCKED Phases with no open questions (P00, P01, P03–P07) are listed at Epic level only — their Task-level detail already exists, completed, in `_PM/Agent-PM/Tasks/` and does not need to be re-litigated here.

### P00 — Architecture Foundations [LOCKED, 100%]
- Epic: Ledger & contract documents (ENGINE-CONTRACT-001, SERVICE-LEDGER-001, AGENTS-SERVICE-001, SERVICE-ARCH-001)
- Epic: Rust service skeleton (SERVICE-SKELETON-001, SERVICE-SQLITE-001)

### P01 — TypeScript Engine Boundary & Rust Cutover [LOCKED, 100%]
- Epic: Engine boundary migration (ENGINE-LOCAL-001 → ENGINE-RUST-CUTOVER-001)
- Epic: TypeScript deprecation discipline (TS-DEPRECATION-AUDIT-001, TS-RUST-PARITY-001/002, TS-DEPRECATION-001, TS-DEPRECATION-TEST-CLEANUP-001)

### P02 — Provider Runtime [LOCKED, 93%]
- Epic: Provider abstraction & contract matrix — DONE (PROVIDER-ABSTRACTION-001, NATIVE-PROVIDER-CONTRACT-MATRIX-001)
- Epic: Native adapters — DONE (NATIVE-ANTHROPIC-ADAPTER-001, NATIVE-OPENAI-ADAPTER-001, NATIVE-GEMINI-ADAPTER-001, NVIDIA_OPENAI_COMPATIBLE_PROVIDER_POC)
  - Subtask: NATIVE-ANTHROPIC-COMPATIBILITY-E2E-001 — DONE
  - Subtask: OPENAI-COMPATIBILITY-E2E-001 — DONE
  - Subtask: REAL-OPENAI-E2E-001 — **PARTIAL (2/10)** — only task in this Epic not closed
- Epic: Routing & selection — DONE (PROVIDER-ROUTING-001/002, PROVIDER-SELECTION-001, MODEL-PROFILE-RESOLUTION-001)
- Epic: Persistence & UI — DONE (PROVIDER-PERSISTENCE-001, PROVIDER-UI-READONLY-001, PROVIDER-SETTINGS-PROFILES-UX-001, PROVIDER-RUNTIME-MODEL-PICKER-MIGRATION-001, PROVIDER-RUNTIME-REMOTE-SELECTION-UX-001, PROVIDER-PROFILE-CONFIG-REMOTE-001, PROVIDER-HEALTH-DISCOVERY-PROFILES-001)
- Epic: Concurrency policy — DONE per ledger §14 LOCKED (`PROVIDER-RUNTIME-CONCURRENCY-POLICY-001`) — **note**: a `Task_Concurrency_v1.0.md`/`v1.1.md` pair in `_PM/Agent-PM/Tasks/` is separately marked NOT-STARTED (0/18). This is a second drift case — see §5.
- Epic: Binary fingerprint — DONE (SERVICE-BINARY-FINGERPRINT-001 in ledger LOCKED) — same drift pattern as Concurrency: a `Task_Fingerprint_v1.0.md` is marked NOT-STARTED (0/11) despite the ledger-tracked ID being LOCKED. Treat `SERVICE-BINARY-FINGERPRINT-001` (ledger ID, done, used by packaged-sidecar smoke tests) as authoritative; `Fingerprint`/`Concurrency` (bare Task IDs without the canonical prefix) as likely abandoned early drafts superseded by the prefixed IDs. Confirm and close out under §5 drift remediation.

### P03–P07 — Context Pipeline (legacy), Orchestration, Graph, Export, Product Surface [all LOCKED, 100%]
No open items. Full task lists already exist in ledger §14 LOCKED block (lines covering `SERVICE-CONTEXT-*` through `BOOKMARK-PANEL-SERVICE-HYDRATION-001`). Not re-expanded here — see ledger for the historical task list, but treat status as frozen/closed; do not reopen without a new Phase.

### P08 — Electron Shell & Packaging [90%]
- Epic: Shell lifecycle — DONE (SERVICE-ELECTRON-001, SERVICE-ELECTRON-SIDECAR-RESTART-001, SERVICE-ELECTRON-GRACEFUL-DRAIN-001)
- Epic: Cross-platform build — DONE (`Task_CrossPlatformBuild_v1.0.md`)
- Epic: Provider selection smoke — DONE (ELECTRON-PROVIDER-SELECTION-SMOKE-001)
- Epic: Packaging hardening — **NEXT** (`SERVICE-ELECTRON-PACKAGING-FUTURE`: signing/notarization for distributable builds)

### P09 — Speech-to-Text [90%]
- Epic: STT boundary & providers — DONE (SPEECH-STT-BOUNDARY-001, SPEECH-STT-UI-001, SPEECH-STT-LOCAL-PROVIDER-001, SPEECH-STT-SETTINGS-001, SPEECH-STT-WHISPER-ADAPTER-001)
- Epic: STT E2E proof — **NEXT** (`SPEECH-STT-E2E-001`)

### P10 — UI Polish [91%, ongoing/ACTIVE-low-grade]
- Epic: Minimap (14 tasks DONE, 1 NOT-STARTED: `CONVERSATION-SCROLL-MINIMAP-RULER-POLISH-002`)
- Epic: Revision paging & highlight (4 tasks, all DONE)
- Epic: Markdown formatting guards (2 tasks, all DONE)
- Epic: Reference scroll fixes (2 tasks, all DONE)
- Epic: Transcript loading & control leaks (3 tasks, all DONE)
This Phase never fully closes — it is the standing bucket for small UI fixes. Treat it as perpetually ACTIVE at low priority rather than driving it toward 100%.

### P11 — Tool Runtime & Registry [67% disputed — DRIFT FLAGGED, see §5]
- Epic: Tool Runtime Boundary — DONE (TOOL-RUNTIME-BOUNDARY-001)
- Epic: Tool Registry — **task files say NOT-STARTED**, ledger says hardening (a downstream consumer) is DONE:
  - Subtask: TOOL-RUNTIME-REGISTRY-001 — task file 0/7, contradicts ledger
  - Subtask: TOOL-RUNTIME-REGISTRY-SEED-DESIGN-001 — task file 0/16
  - Subtask: TOOL-RUNTIME-REGISTRY-SEED-001 — task file 0/7, but ledger LOCKED references seed as shipped ("Tool Registry seed (four Loom-native descriptors)" in §19 Agent Phase 1A)
  - Subtask: TOOL-RUNTIME-REGISTRY-INTROSPECTION-001 — task file 0/6
  - Subtask: TOOL-RUNTIME-REGISTRY-SHARED-STATE-001 — DONE (10/10)
- Epic: Tool Stack hardening — DONE (AGENT-RUNTIME-TOOL-STACK-HARDENING-001, 13/13) — this Epic logically depends on Registry being seeded, which is a direct contradiction if Registry/Seed are truly 0% complete. **This Phase cannot be trusted until the drift in §5 is resolved.**

### P12 — Agent Runtime Foundation [LOCKED, 100%]
- Epic: Core runtime — DONE (AGENT-RUNTIME-FOUNDATION-001)
- Epic: Internal API & experimental route — DONE (AGENT-RUNTIME-API-INTERNAL-001, AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001)
- Epic: Cancellation — DONE (AGENT-RUNTIME-CANCELLATION-001)
- Epic: Cleanup — DONE (AGENT-RUNTIME-FOUNDATION-CLEANUP-001)

### P13 — Agent Run Persistence & Inspector [LOCKED, 100%]
- Epic: Persistence — DONE (AGENT-RUN-PERSISTENCE-001 + POST-VALIDATION)
- Epic: Inspector — DONE (AGENT-RUN-INSPECTOR-PERSISTENCE-001, AGENT-UI-RUN-INSPECTOR-001)

### P14 — Retrieval Architecture [LOCKED, 100%]
- Epic: Projection contracts — DONE (SQLITE-PROJECTION-CONTRACTS-001)
- Epic: Lexical adapter — DONE (TANTIVY-RETRIEVAL-ADAPTER-001)
- Epic: Semantic adapter — DONE (LANCEDB-RETRIEVAL-ADAPTER-001)
- Epic: Hybrid fusion — DONE (HYBRID-RETRIEVAL-SERVICE-001)
- Epic: Diagnostics — DONE (RETRIEVAL-DIAGNOSTICS-001) — ledger §19 marks this "deferred"; the Task/QA files show 28/28 complete. Treat task-file state as ground truth (drift case, see §5).

### P15 — Scope Resolution & Context Selection [LOCKED, 100%]
- Epic: Scope Resolution — DONE (SCOPE-RESOLUTION-001, 32/32)
- Epic: Context Selection contract & service — DONE (CONTEXT-SELECTION-SERVICE-001, 22/22)
Ledger §19 Agent Phase 2G is marked "deferred." This is stale — both Plan docs (`Phase2_ScopeResolutionDesign_v1.0.md`, `Phase2_ContextSelectionContractDesign_v1.0.md`) and the paired Task/Test/QA files show full completion. Treat this Phase as LOCKED.

### P16 — Agent Context Manager & Context Snapshot [LOCKED, 100%]
- Epic: Context Manager design + implementation — DONE (AGENT-CONTEXT-MANAGER-001)
- Epic: Context Snapshot — DONE (CONTEXT-SNAPSHOT-MIGRATION-001, CONTEXT-SNAPSHOT-LINKING-001)

**DRIFT CORRECTION FOR P15 & P16**: While fully completed and LOCKED as architectures, `ContextSelectionService` and `AgentContextManager` are **not yet the production path**. Main Generation currently uses the legacy `ContextManager`. Do not wire the V2 services directly into `AgentRun` without the bridging strategy defined in `CONTEXT-INTEGRATION-SPEC-AMEND-001`.

### P17 — Memory Subsystem [LOCKED, 100%]
- Epic: Schema foundation — DONE (MEMORY-POLICY-SQLITE-001, 10/10)
- Epic: Write pipeline
  - Subtask: MEMORY-WRITE-PIPELINE-EXPLICIT-001 — DONE (10/10)
  - Subtask: MEMORY-CONFLICT-SUPERSESSION-001 — DONE (14/14)
  - Subtask: MEMORY-TOPIC-KEY-MANUAL-001 — DONE (10/10)
- Epic: Policy controls
  - Subtask: MEMORY-ALWAYS-INCLUDE-001 — DONE (12/12)
  - Subtask: MEMORY-FORGET-001 — DONE (11/11)
- Epic: Read pipeline
  - Subtask: MEMORY-READ-POLICY-001 — DONE (15/15)
- Epic: Projection sync
  - Subtask: MEMORY-PROJECTION-INVALIDATION-001 — DONE (14/14)
- Note: ledger §17 found the *design doc* `Phase4_MemoryPolicyEngineDesign_v1.0.md` itself has unresolved spec gaps. Flag as a documentation-debt item, not a phase-completion blocker.

### P18 — Agent Behavior [LOCKED, 100%]
- Epic: Agent Behavior Foundation — DONE (AGENT-BEHAVIOR-FOUNDATION-001)

### P19 — Settings IA, Privacy & Data Backlog [HOLD-BACKLOG, 0%]
- Epic: Settings IA — `SETTINGS-INFORMATION-ARCHITECTURE-001` (note: `SETTINGS-IA-UI-001` and `SETTINGS-IA-POLISH-002` already shipped under P08-adjacent work per ledger LOCKED; this backlog item may already be partially superseded — verify before resuming)
- Epic: Memory governance — `MEMORY-WRITE-POLICY-001`, `MEMORY-AUDIT-001` (likely superseded by P17 Memory Subsystem work — verify before resuming; P17's MEMORY-ALWAYS-INCLUDE-001/MEMORY-FORGET-001/MEMORY-CONFLICT-SUPERSESSION-001 cover most of what these backlog items describe)
- Epic: File/RAG boundary — `FILE-RAG-BOUNDARY-001`, `FILE-RAG-SQLITE-001`
- Epic: Data & storage settings — `DATA-STORAGE-SETTINGS-001`
- Epic: Privacy settings — `PRIVACY-SETTINGS-001`
- Epic: UI preferences — `UI-PREFERENCES-001`
This entire Phase needs a re-scoping pass before being reactivated — several items may already be done. Do not blindly schedule from this list; verify against P08/P17 first.

### P20 — Multi-Agent Execution Topology [ACTIVE, 30%]
- Epic: `MODEL-EXECUTION-TOPOLOGY-DESIGN-001` — DONE
- Epic: `PROVIDER-CONCURRENCY-POLICY-DESIGN-001` — DONE
- Epic: `SUBAGENT-RUNTIME-DESIGN-001` — DONE
- Epic: `TOOL-SCHEDULER-DESIGN-001` — DONE
- Epic: `TOOL-SCHEDULER-IMPLEMENTATION` — **DONE** (drift correction, `ROADMAP-EXECUTION-ENGINE-RESTRUCTURE-001`: directly confirmed by code review and passing tests during `TOOL-RUNTIME-IMPLEMENTATION-STATE-AUDIT-001` and `AGENT-EXECUTION-SCHEDULER-001` — `migrations/0028_tool_scheduler_foundation.sql`, `storage/repositories/tool_scheduler.rs`, and `tool_scheduler_runtime.rs` all exist with real CRUD/lifecycle logic and ~20+ passing tests; this Epic was stale at NEXT)
  - Subtask: `TOOL-SCHEDULER-SCHEMA-001` — DONE
  - Subtask: `TOOL-SCHEDULER-REPOSITORY-001` — DONE
  - Subtask: `TOOL-SCHEDULER-RUNTIME-001` — DONE
  - Subtask: `TOOL-PERMISSION-MODEL-001` — DONE
  - Subtask: `TOOL-ARTIFACTS-001` — DONE
- Note: "implemented" here means the scheduling/permission/artifact-lifecycle *foundation* is real and tested — it does not mean any node can yet execute a real tool. See P22 (Execution Engine) Epics 3–4 (Dispatcher, Node Executors) for the remaining gap, and `docs/tool_runtime_implementation_state_audit.md` for the full audit this correction is based on.

### P21 — V1/V2 Boundary & AgentRun Shim Integration [ACTIVE, 95%]
- Epic: Boundary & Audits
  - Subtask: `LOOM-V1-V2-BOUNDARY-AUDIT-001` — DONE
  - Subtask: `LOOM-V1-V2-CODEBOUNDARY-MARKING-001` — DONE
  - Subtask: `CONTEXT-PIPELINE-FLOW-AUDIT-001` — DONE
  - Subtask: `CONTEXT-INTEGRATION-SPEC-AMEND-001` — DONE
- Epic: Execution Shims
  - Subtask: `AGENTRUN-CONTEXT-CONSUMPTION-001` — DONE
  - Subtask: `MAIN-GENERATION-AGENTRUN-SHIM-001` — DONE
  - Subtask: `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001` — DONE (design only — see `docs/quick_ask_agentrun_design.md`; implementation is separately tracked as `QUICK-ASK-AGENTRUN-MODE-001`/`QUICK-ASK-AGENTRUN-SHIM-001`, not yet scheduled)
- Epic: Bridges
  - Subtask: `PROVIDER-RUNTIME-BRIDGE-001` — DONE
  - Subtask: `TOOL-RUNTIME-ADAPTER-CONTRACT-001` — **DONE** (drift correction, `ROADMAP-EXECUTION-ENGINE-RESTRUCTURE-001`: implemented and committed this session — `tool_adapter_contract.rs`, the canonical `ToolAdapter` trait and request/result/artifact/context/memory/telemetry/error contract every future adapter must implement; this Epic was stale at HOLD)
  - Subtask: `SUBAGENT-EXECUTION-SEAM-001` — HOLD (correctly held — depends on P22 Epic 5, Execution Plan Revision, per the new dependency ordering this restructure introduces; do not unhold before that epic exists)

---

### P22 — Execution Engine [ACTIVE, ~22%]

New Phase under `ROADMAP-EXECUTION-ENGINE-RESTRUCTURE-001`, formalizing the canonical execution-engine architecture from `docs/agent_execution_graph_design.md` and `docs/agent_execution_engine_design.md`. The architectural *decisions* in this Phase (the shape of the graph, the scheduler/dispatcher boundary, the continuation policy, versioning, checkpoints) are **LOCKED** — they are not open design questions — but locking a decision is not the same as completing its implementation, and the per-epic status below reflects actual code state, not the decision's lock status. Conflating the two is exactly the kind of drift `docs/pm_operating_model.md` exists to prevent.

Canonical execution engine pipeline:

```
Planner                              (P23 — not yet implemented)
  ↓ produces
Execution Plan                       (P23)
  ↓ compiled into
Execution Graph                      (versioned template + instance — P22 Epic 1, DONE)
  ↓ scheduled by
Execution Scheduler                  (ready-node discovery, lease/heartbeat/release,
                                       metadata-only recovery — P22 Epic 2, DONE)
  ↓ dispatched by
Execution Dispatcher                 (P22 Epic 3 — NOT STARTED)
  ↓ runs
Node Executors                       (Provider / Tool / ContextBuild / Join / Finish / ...
                                       — P22 Epic 4 — NOT STARTED)
```

Epics, in dependency order (Dispatcher immediately follows Scheduler; Plan Revision precedes any SubAgent, Human Approval, or Memory-routing node-type work, per this restructure's explicit ordering requirement):

1. **Execution Graph** — Design LOCKED, **DONE**. `AGENT-EXECUTION-GRAPH-TYPES-001`: canonical types (`GraphTemplate`, `GraphInstance`, `NodeDefinition`/`NodeInstance`, `EdgeDefinition`/`EdgeInstance`, `NodeAttempt`, `Lease`, `ContinuationCheckpoint`), all required enums, deterministic DAG validation (cycle/orphan/unreachable/duplicate-node-id/dangling-edge detection), migration 0030, CRUD-only repository (`execution_graph.rs`). See "DAG Invariant" below.
2. **Execution Scheduler** — Design LOCKED, **DONE**. `AGENT-EXECUTION-SCHEDULER-001`: `ExecutionScheduler`/`ReadyQueue`/`LeaseManager`/`DependencyResolver`/`JoinResolver`/`RecoveryScanner` (`execution_scheduler.rs`). Decides what may run next; never executes anything — enforced by a static source-guard test. `WAITING_FOR_USER_CONTINUATION` nodes are structurally excluded from both discovery and recovery requeue. See "Continuation Policy" below.
3. **Execution Dispatcher** — Design LOCKED (the scheduler/dispatcher boundary is already decided and enforced in code: the Scheduler returns `ReadyForExecution`/`ReadyBatch` identities only and never calls Provider Runtime, Tool Scheduler Runtime, a Tool Adapter, AgentRuntime, or Context Manager), **NOT STARTED**. Next task: `AGENT-EXECUTION-DISPATCH-001` — takes a `ReadyForExecution` item and invokes the correct subsystem for that node's `node_type`, then reports the outcome back via `ExecutionScheduler::report_attempt_outcome`.
4. **Node Executors** — **NOT STARTED**. Per-`NodeType` execution logic the Dispatcher invokes once it exists: `Provider` → Provider Runtime Bridge path (already production-ready per P21); `Tool` → Tool Scheduler Runtime + a real `ToolAdapter` implementation (contract exists per P21, no concrete adapter exists yet — see `docs/tool_runtime_implementation_state_audit.md` §5 for the recommended adapter build order); `ContextBuild` → legacy `ContextManager` per the existing bridge; `Join`/`Finish` → metadata-only, already fully expressible with existing Scheduler primitives. Depends on Epic 3.
5. **Execution Plan Revision** — **NOT STARTED**. See "Plan Revision Policy" below. Hard-blocks any future SubAgent, Human Approval, or Memory-routing node-type work, since all three require a defined mutation path for an in-flight graph before they can be built safely.
6. **Execution Recovery** — Design LOCKED, **PARTIALLY DONE**. The Scheduler's `RecoveryScanner`/`run_startup_recovery` already implements metadata-only crash/restart recovery (expired-lease detection, abandoned-attempt marking, safe requeue that never touches a `WaitingForUserContinuation` node). Remaining: wiring an actual startup-recovery call into service boot (`main.rs`), and the idempotency cross-check against Tool Scheduler/Provider Runtime terminal records before re-attempting an abandoned node — explicitly deferred by `AGENT-EXECUTION-SCHEDULER-001`'s own stated scope, not an oversight.
7. **Execution Optimization** — **NOT STARTED, reserved**. Targeted successor-only re-evaluation (vs. today's full-rescan-per-tick `discover_ready_batch`), batching, and any other performance work. Explicitly deferred until Epics 3–6 are real and have measured behavior to optimize — building this first would be optimizing a system that doesn't exist yet.

**Continuation Policy (canonical, LOCKED)**: `WAITING_FOR_USER_CONTINUATION` is the canonical continuation boundary after every `Provider` node. Reasoning never resumes automatically. This is enforced structurally today, not just by convention: `discover_ready_batch` only ever considers `Pending` nodes (a `WaitingForUserContinuation` node is never `Pending`), and `report_attempt_outcome` explicitly raises an error if called against a node already in that state. Tool execution and other background work already in flight when a Provider node completes are unaffected and continue to their natural completion. The only way out of `WaitingForUserContinuation` is a future, explicit, user-triggered continuation API — deliberately **not implemented** in this Phase; building it is part of Execution Plan Revision (Epic 5), since "continue" and "continue with a new instruction" are two faces of the same plan-mutation problem.

**DAG Invariant (canonical, LOCKED)**: the execution graph is and remains a DAG; the engine never executes a cyclic graph. A Provider "loop" (multi-turn reasoning) is represented as a new Graph Instance, or — once Epic 5 exists — a new Graph Revision, never as a backward edge in a persisted graph. This is already enforced today, not aspirational: `validate_graph_definition`'s cycle detection (Kahn's-algorithm-based topological sort) rejects any template containing a cycle at template-creation time, unconditionally.

**Depends On**: P12 (Agent Runtime Foundation), P16 (Context Manager/Snapshot), P20 (Tool Scheduler foundation), P21 (Provider Runtime Bridge, Tool Adapter Contract).
**Blocks**: any future SubAgent, Human Approval, or Memory-routing node-type work — all three require Execution Plan Revision (Epic 5) first.

### P23 — Planning Architecture [NOT STARTED, 0%]

New Phase separating **Planning** (this Phase) from **Behavior** (P24) — previously conflated under the single P18 "Agent Behavior" label. P18 is left untouched (historical, LOCKED, not renumbered, checklist not modified) per this restructure's explicit instruction not to alter completed tasks — but its scope should be read narrowly going forward; new planning work belongs here, not by reopening P18.

Canonical planning pipeline:

```
Planner
  ↓
Execution Plan            (task breakdown, ordered checklist, dependency graph, estimated work)
  ↓
Execution Graph            (compiled, versioned — P22 Epic 1)
  ↓
Execution Graph Revision   (produced only via Execution Plan Revision, P22 Epic 5 —
                             never an in-place edit; every revision is immutable)
  ↓
Execution History          (durable record of every graph instance/revision a run ever produced)
```

Every development task begins as a planning problem. The Planner is responsible for producing a task breakdown, an ordered checklist, a dependency graph, and an estimated-work figure. The Scheduler (P22 Epic 2) executes the resulting plan. The Dispatcher (P22 Epic 3) dispatches individual nodes. These three responsibilities are architecturally distinct and must not be merged into one component — this separation is itself a locked decision of this restructure, independent of how much of P22/P23 is implemented yet.

Epics (all **NOT STARTED** — no implementation exists for any of them):
- **Planner** — produces an Execution Plan from a user request.
- **Task Plan** — the structured output of the Planner (breakdown, ordering, dependencies, estimate).
- **Checklist / Todo** — see "Execution Graph UI" below; the user-visible projection of a Task Plan, not a separate data model.
- **Graph Revision** — the mechanism by which a Task Plan becomes a new, immutable Execution Graph instance/revision (the design counterpart to P22 Epic 5's runtime mechanics).
- **Plan Mutation** — Planner-side logic that takes current execution state plus a new user instruction and produces a revised plan, which is the direct input to Graph Revision. See "Plan Revision Policy" in P22.
- **Progress** — derived, read-only reporting over Execution History; never a second source of truth for node state, which remains the Execution Graph/Scheduler's domain (P22) exclusively.
- **Execution History** — durable, queryable record of every Graph Instance and Graph Revision a run has produced, for audit/replay — extends the content-free persistence discipline already established in `docs/agent_execution_engine_design.md` §4; no new privacy surface is introduced by this Epic's eventual implementation.

**Execution Graph UI note**: the user-visible checklist/todo list is **merely a visualization of the execution graph** — never an independent state machine. The underlying engine always executes a DAG (P22's DAG Invariant); the checklist UI is a read-only projection of `NodeInstance`/`EdgeInstance` state, not a parallel tracking mechanism a frontend could drift out of sync with by construction. No frontend work exists yet for this — this is a constraint on the eventual UI implementation, recorded now so it is not violated later, not a UI task in itself.

**Depends On**: P22 (an Execution Graph must exist as a compilation target before a Planner can produce one).

### P24 — Behavior Steering [NOT STARTED, 0%]

The other half of the Planning/Behavior split introduced by this restructure (see P23). Behavior governs *how* the agent conducts itself across scopes; Planning (P23) governs *what* it intends to do. These were previously mixed together under P18's single "Agent Behavior" label.

Epics (all **NOT STARTED**):
- **Global Steering** — cross-session behavioral configuration (tone, defaults, persistent operating constraints).
- **Session Steering** — per-Loom/per-conversation behavioral state.
- **Execution Steering** — per-run, in-flight behavioral adjustments (e.g., user guidance given at a continuation boundary about *how* to proceed) — distinct from a Plan Mutation (P23), which changes *what* runs next, not *how* it behaves while running.

P18 "Agent Behavior" (LOCKED, 100%, `AGENT-BEHAVIOR-FOUNDATION-001`) is the historical, conflated predecessor of this split. Its checklist and LOCKED status are unmodified by this restructure — per the explicit instruction not to alter completed tasks — but any new behavior-steering work should be scoped under this Phase, not by reopening P18.

**Depends On**: P18 (Agent Behavior Foundation, as precedent infrastructure), P22 (Execution Steering needs the Scheduler's run-level state to attach adjustments to).

---

## 4. Big Picture Tracking

### 4.1 Overall completion

Counting only Phases with tracked Task-level checklists (P02, P08–P17; P00/P01/P03–P07 are frozen-complete and excluded from the live denominator since they have no open items to track):

- Total tracked checklist items across active/recently-active Phases: **285**
- Completed: **~271** (95%)
- Partial: **~0 tasks** (excluding disputed Tool Registry subtasks in P11)
- Not started: **~4 tasks** (P10's ruler-polish, P11's three disputed Registry subtasks)

**Overall roadmap completion: approximately 86–89%**, with the range reflecting the unresolved P11 drift (resolving it could move completion either up, if the ledger is right and task files are stale, or hold steady, if the task files are right and the ledger over-claimed).

### 4.2 Per-phase completion (see §2 table `Completion %` column for the canonical numbers)

### 4.3 Remaining effort (relative sizing, not calendar estimates)

| Phase | Remaining Work | Relative Size |
|---|---|---|
| P02 | Finish REAL-OPENAI-E2E-001; resolve Concurrency/Fingerprint task-file drift | Small |
| P08 | Signing/notarization for distributable packaging | Medium |
| P09 | One E2E task | Small |
| P10 | One UI task (ruler polish), plus ongoing low-grade backlog | Small, perpetual |
| P11 | Resolve drift (audit, not build); then possibly nothing further, or full Registry build if drift reveals real gap | Unknown until audited — potentially Medium-Large |
| P17 | DONE | None |
| P18 | DONE | None |
| P19 | Re-scope, then implement whatever survives the scope cut | Medium, pending re-scope |
| P20 | DONE (corrected this restructure — see §5 item 6) | None |
| P21 | `QUICK-ASK-AGENTRUN-SHIM-001` implementation; `SUBAGENT-EXECUTION-SEAM-001` remains correctly held pending P22 Epic 5 | Small |
| P22 | Execution Dispatcher, Node Executors, Execution Plan Revision, remaining half of Execution Recovery, Execution Optimization | Large |
| P23 | Entire Phase — Planner, Task Plan, Checklist/Todo, Graph Revision, Plan Mutation, Progress, Execution History | Large |
| P24 | Entire Phase — Global/Session/Execution Steering | Medium |

### 4.4 Critical path

```
P21 V1/V2 AgentRun Shim Integration
  -> P22 Execution Engine (Execution Graph [done] -> Execution Scheduler [done]
       -> Execution Dispatcher -> Node Executors -> Execution Plan Revision)
  -> P23 Planning Architecture (Planner -> Execution Plan -> Graph Revision)
  -> P20/P22-gated multi-agent work (SubAgent, Human Approval, Memory-routing
       node types — all require P22 Execution Plan Revision first)
```

P22 is now the center of the critical path: its first two epics (Execution Graph, Execution Scheduler) are done, but the Execution Dispatcher and Node Executors — the components that actually make any of this *do* anything — have not been started. Until they exist, P22's Execution Graph/Scheduler are correctly-built infrastructure with nothing yet wired to use them in production, structurally identical to the disconnection pattern already documented for `ContextSelectionService`/`AgentContextManager` in P15/P16's drift correction note.

P23 (Planning Architecture) is now also effectively on the critical path for any future multi-agent or graph-revision work, since Execution Plan Revision (P22 Epic 5) is defined as Planning Architecture's runtime counterpart — neither can usefully ship without the other.

P11's drift resolution is **not on the critical path for P17/P18** and, following this restructure's correction of P20's status (§5 item 6), is **no longer blocking P20** either — the Tool Scheduler foundation is confirmed implemented independent of the older `agent_runtime/tool_registry.rs` drift, which remains a separate, still-unresolved cleanup item (see `docs/tool_runtime_implementation_state_audit.md` §4–§5).

P08 (packaging/signing) and P09 (STT E2E) are independent side branches — they do not block P17/P18/P20/P21/P22/P23/P24 and can proceed in parallel at any time.

P19 is explicitly deprioritized (HOLD-BACKLOG) and is off the critical path entirely until someone re-scopes it.

---

## 5. Drift Cases Found During This Rebase

These are concrete instances of roadmap/ledger disagreement discovered while compiling this document. They are listed here as a worked example of what `docs/pm_operating_model.md` §4 (drift detection) should catch automatically going forward.

1. **Agent Phase 2G (Scope Resolution / Context Selection) marked "deferred" in ledger §19, but fully shipped per Task/Test/QA files.** Resolution: this roadmap (§2, §3 P15) supersedes the ledger; treat P15 as LOCKED.
2. **Agent Phase 2F (Retrieval Diagnostics) marked "deferred" in ledger §19, but fully shipped (28/28) per Task/QA files.** Resolution: P14 includes this as LOCKED.
3. **Agent Phase 4 (Memory) marked a single placeholder `AGENT-MEMORY-001 (deferred)` in ledger §19, but 8 distinct, mostly-completed tasks exist in `_PM/Agent-PM/`.** Resolution: P17 in this document replaces the single placeholder with the real Epic/Task breakdown.
4. **Tool Registry tasks (`TOOL-RUNTIME-REGISTRY-001`, `-SEED-DESIGN-001`, `-SEED-001`, `-INTROSPECTION-001`) show 0% in their own Task files, but the ledger's LOCKED block and Agent Phase 1A description both describe the Tool Registry and its seed as shipped, and a downstream task (`AGENT-RUNTIME-TOOL-STACK-HARDENING-001`, which presupposes a working registry) is fully DONE.** This is the most serious unresolved drift in the codebase's PM tracking. Possible explanations: (a) the Task files were never updated after work was actually completed under a different/untracked task, (b) the ledger over-claimed completion that only happened informally, or (c) the registry was built directly without ever going through these specific task files (e.g., as part of `AGENT-RUNTIME-FOUNDATION-001` instead). **Action required**: before any P20 (multi-agent) design work begins, run a direct code audit of `services/loom-service/src/capabilities/` (or wherever the tool registry actually lives) against the four disputed task files, and update whichever side is wrong. Not resolved in this document because it requires reading current source code, which is out of scope for a planning-only rebase.
5. **`Task_Concurrency_v1.0/v1.1.md` and `Task_Fingerprint_v1.0.md` show 0% completion, but ledger-tracked IDs `PROVIDER-RUNTIME-CONCURRENCY-POLICY-001` and `SERVICE-BINARY-FINGERPRINT-001` are LOCKED and are actively relied upon (the fingerprint check is used in the packaged-sidecar smoke test from a recent session in this same project).** Resolution: the bare (unprefixed) Task IDs are almost certainly abandoned early drafts superseded by the canonically-prefixed ledger IDs. Recommend archiving `Task_Concurrency_*` and `Task_Fingerprint_*` (and their paired Test/QA files) with a note pointing to the superseding ledger ID, rather than leaving them as misleading 0%-complete entries.
6. **(Resolved during `ROADMAP-EXECUTION-ENGINE-RESTRUCTURE-001`) P20's `TOOL-SCHEDULER-IMPLEMENTATION` epic and its five subtasks were marked `NEXT` (0% implied), and P21's `TOOL-RUNTIME-ADAPTER-CONTRACT-001` was marked `HOLD`, but both are now confirmed `DONE` by direct code review and passing test suites performed earlier in this same session (`TOOL-RUNTIME-IMPLEMENTATION-STATE-AUDIT-001`, `AGENT-EXECUTION-GRAPH-TYPES-001`, `AGENT-EXECUTION-SCHEDULER-001`, and the `TOOL-RUNTIME-ADAPTER-CONTRACT-001` implementation itself — `migrations/0028_tool_scheduler_foundation.sql`, `storage/repositories/tool_scheduler.rs`, `tool_scheduler_runtime.rs`, and `tool_adapter_contract.rs` all exist with real, tested logic).** This is *not* the same drift as case 4 above: case 4 concerns the older, separate, still-unresolved `agent_runtime/tool_registry.rs` in-memory registry, which remains exactly as disputed as before. Resolution: §3 P20/P21 corrected in this document; case 4 is intentionally left open since this correction does not touch it.
7. **(Identified during `ROADMAP-EXECUTION-ENGINE-RESTRUCTURE-001`) The task background for this restructure asserted that "Dispatcher" is among the architectural decisions now considered LOCKED, which could be misread as "the Dispatcher is done."** It is not — `AGENT-EXECUTION-SCHEDULER-001`'s own source comments explicitly mark dispatch as out of scope (`next_task: AGENT-EXECUTION-DISPATCH-001`), and no dispatcher code exists. Resolution: P22 §3 distinguishes "design LOCKED" from "implementation status" explicitly for every Epic, specifically to prevent this exact misreading from being baked into the roadmap as a false completion claim.

---

## 6. Changelog

- v1.0 (this document): Initial master roadmap created under ROADMAP-REBASE-001, replacing the dual Service-Phase/Agent-Phase numbering in `docs/loom_service_architecture_ledger.md` §13/§19 with a single canonical Phase list (P00–P20). Five drift cases identified and documented in §5 but not resolved (resolution requires code audit, out of scope for this design-only task). P20 (Multi-Agent Execution Topology) added as a new future-planning Phase per task instruction.
- v1.1 (`ROADMAP-EXECUTION-ENGINE-RESTRUCTURE-001`): Added P22 (Execution Engine), P23 (Planning Architecture), P24 (Behavior Steering) — no existing Phase renumbered, no completed Task's checklist altered. P22 formalizes the canonical execution-engine pipeline (Execution Graph → Execution Scheduler → Execution Dispatcher → Node Executors → Execution Plan Revision → Execution Recovery → Execution Optimization) per `docs/agent_execution_graph_design.md`/`docs/agent_execution_engine_design.md`, with the Continuation Policy (`WAITING_FOR_USER_CONTINUATION` as the canonical, never-automatic continuation boundary) and the DAG Invariant (provider "loops" are a new Graph Instance/Revision, never a literal cycle) both documented as locked decisions already enforced in shipped code. P23/P24 formally split "Planning" from "Behavior," previously conflated under P18's single "Agent Behavior" label — P18 itself is untouched. Two drift corrections made (§5 items 6–7): P20's `TOOL-SCHEDULER-IMPLEMENTATION` epic and P21's `TOOL-RUNTIME-ADAPTER-CONTRACT-001` were stale (`NEXT`/`HOLD`) and are now confirmed `DONE` by this session's own direct code review; and the task's "Dispatcher is LOCKED" framing is clarified to mean the *design boundary* is locked, not that the Dispatcher is implemented (it is not). Critical path (§4.4) updated to center on P22's Dispatcher/Node Executors gap.
