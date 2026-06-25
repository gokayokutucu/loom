# Quick Ask / AgentRun Integration Design v1.0

Status: DESIGN ONLY — no runtime, frontend, or API behavior changed by this document.
Task: `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001`

## 0. Purpose and Grounding

This document designs how Quick Ask (`POST /ask/quick`, `api/ask.rs`) should evolve toward the V2 Agent Runtime without losing the latency characteristics that are its entire reason to exist. It is grounded in the actual current code, not aspiration:

- **Quick Ask today** (`api/ask.rs::quick`): no repository calls, no context selection, no retrieval, no memory/capsule/Weft/reference persistence. The provider request is built with `stream: Some(false)` (single blocking completion, not SSE), `think: Some(false)`, capped `num_ctx`/`num_predict`, `temperature: 0.2` (confirmed by `quick_ollama_request_forces_no_thinking_fast_budget_and_no_streaming` in `api/ask.rs`). It is the fastest, cheapest, most ephemeral request shape in the codebase by design.
- **Main Generation today** (`api/orchestration.rs`): creates a `MainGenerationAgentRunShim` that writes `agent_runs`/`agent_steps`/`agent_events` rows around its own still-direct, still-streaming `ProviderPipeline::stream_chat` call, and as of `PROVIDER-RUNTIME-BRIDGE-001`, also drives `ProviderRuntimeService` lifecycle metadata around that same call. It still does not call `AgentRuntimeService::execute`/`execute_run` — `test_product_paths_do_not_call_agent_runtime` (in `agent_runtime/service.rs`) enforces this boundary today for *both* `orchestration.rs` and `ask.rs`.
- **AgentRuntime today** (`agent_runtime/runtime.rs::execute_run`): a full event-sourced state machine — `run.created → run.started → step(context) → step(provider) → provider.started → provider.delta* → provider.completed → step(tool, placeholder) → step(artifact, placeholder) → step(validation, placeholder) → run.completed` — with a durable repository write at nearly every transition (`AgentRunRepository::insert_run`/`transition_run`/`insert_step`/`finish_step`/`append_event`/`finish_run`). It already knows how to consume the legacy `ContextManager` via `LegacyContextRuntimeInput` and drives `ProviderRuntimeService` around its own `ProviderPipeline::stream_chat` call.

The central tension this document resolves: **AgentRun's value (audit trail, replay, durable lifecycle, future multi-step/tool/subagent capability) is built almost entirely out of repository writes and step machinery that Quick Ask's design explicitly avoids.** Forcing Quick Ask through the same machinery either (a) destroys its latency advantage, or (b) requires a second, deliberately hollowed-out execution mode. This document argues for (b) and specifies exactly how hollow it must be.

---

## 1. Answers to the 16 Questions

### Q1 — Should Quick Ask create an AgentRun? Always, or only optionally?

**Yes, but only a lightweight variant, and only optionally relative to today's behavior.** Concretely: Quick Ask should create an `AgentRun` row, but never the full event-sourced execution the current `execute_run` state machine produces for Main Generation. "Optionally" in the sense that it should be gated behind the same kind of flag Main Generation's shim already demonstrates is safe to add incrementally (`MainGenerationAgentRunShim` was added without changing the SSE contract) — Quick Ask gets an equivalent `QuickAskAgentRunShim`, introduced behind a feature flag so it can be rolled out, measured, and rolled back without coordinating a frontend release. Once measured safe, it becomes the unconditional default — there is no product reason for some Quick Ask calls to be tracked and others not.

### Q2 — Should Quick Ask create AgentRunStep records?

**No.** Steps exist to make a multi-phase execution (context → provider → tool → artifact → validation) auditable and resumable phase-by-phase. Quick Ask has exactly one phase: a single blocking provider call. A `Step` row for a single-phase execution adds two repository writes (`insert_step`, `finish_step`) and a `step.started`/`step.completed` event pair for zero audit benefit beyond what the run's own terminal state already says. Skip steps entirely for Quick Ask.

### Q3 — Should Quick Ask write AgentEvents?

**A minimal, fixed set only: `run.created`, `run.started`, and exactly one terminal event (`run.completed`/`run.failed`/`run.cancelled`).** No `step.*` events (per Q2), no `provider.started`/`provider.delta`/`provider.completed` events — Quick Ask's provider call is non-streaming, so there is no delta stream to report, and `provider.started`/`provider.completed` would be redundant with the run's own start/terminal events when there is only ever one provider call per run. This is 2-3 durable event rows instead of Main Generation's ~7+.

### Q4 — Should Quick Ask reuse ContextManager, or have its own lightweight context path?

**Neither, unchanged from today: no context path at all.** This is not a hard requirement of the AgentRun integration — it is a product decision already made and re-affirmed by `docs/context_integration_spec_amendment.md` §6 ("Quick Ask remains the V1 fast path... intentionally bypasses deep context work"). Quick Ask's prompt is built directly from the request's selected fragment / active references / mini-conversation turns (`quick_messages`, `quick_user_prompt` in `api/ask.rs`) with no Knowledge Layer involvement. Wrapping this in an `AgentRun` does not require giving it a context path — `AgentRuntime` already supports `legacy_context: None` (the "minimal request path" the existing test `test_agent_runtime_without_legacy_context_preserves_minimal_request_path` proves out) for exactly this shape. **Do not build a third, separate "lightweight context path."** That would be a second context implementation to maintain for no measured benefit; Quick Ask's existing inline prompt construction already is the lightweight path.

### Q5 — Should Quick Ask create References / Capsules / Memories / Snapshots, or none?

- **References: no.** Quick Ask consumes References as input (already supported) but does not mint new ones from its own output. Promotion to a Reference happens through the existing "Convert to Weft" / Bookmark flows, which are deliberate user actions, not implicit side effects of asking a quick question.
- **Capsules: no.** Capsules summarize a Response for later context reuse; Quick Ask answers are not canonical Responses in a Loom until promoted.
- **Memories: no** — explicitly called out as a non-goal in `docs/context_integration_spec_amendment.md` §6 ("It will bypass full memory writes (as per V1 design)").
- **Context Snapshots: a minimal one, content-free, only if `AGENTRUN-CONTEXT-CONSUMPTION-001`'s pattern is followed — but since Q4 establishes Quick Ask has no context phase to snapshot, the honest answer is none, with one carve-out below (Q13).**

### Q6 — Should Quick Ask appear inside history?

**Not as a Loom/Response history entry — that already requires explicit promotion (Bookmark/Convert to Weft), and this design does not change that.** But it *can* appear in the **Agent Run history** (the existing `GET /experimental/agent/runs` family) once it creates an `AgentRun` row per Q1 — that is a separate, lower-stakes surface (gated behind `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API`, used for debugging/audit, not user-facing product history) and showing ephemeral Quick Ask runs there is consistent with that surface's existing purpose.

### Q7 — Should Quick Ask be replayable?

**No, and it structurally cannot be in any useful sense even after this integration.** Replay (per `docs/agent_runtime_contracts.md` §10, Context Snapshot rule 7) means "rehydrate current canonical content from SQLite by source identity." Quick Ask has no canonical source identity for its inputs — no persisted Response, no Context Snapshot, no Reference resolution recorded. The `AgentRun` row this design adds is an audit record of *that an execution happened*, not a replayable execution.

### Q8 — Should Quick Ask support branching?

**No.** Branching (Weft) is a Loom/Response graph concept. Quick Ask produces no Response, so there is nothing to branch from until/unless the user promotes the answer — at which point it becomes a normal Loom/Weft flow, entirely outside Quick Ask's own execution model.

### Q9 — Should Quick Ask support Wefts?

**No, for the same reason as Q8.** "Convert to Weft" already exists as a *post-hoc* promotion path that takes Quick Ask's *visible output* and starts a real Loom/Weft from it — that promotion is a Main Generation/Loom-side concern, not something Quick Ask's own execution needs to know about.

### Q10 — What is the acceptable latency budget? (V1 vs future AgentRun)

See §6 (Performance Comparison) for the full breakdown. Summary: **the AgentRun wrapper's overhead budget must stay under ~5ms p50 / ~15ms p99 added latency**, because Quick Ask's entire value proposition is sub-second-feeling responsiveness for a single blocking call; anything that adds double-digit-millisecond overhead on top of a fast local model response is user-visible. The two repository writes this design proposes (`run.created`+`run.started` is one combined insert; one terminal write) are each single-row SQLite inserts on an already-open connection pool — well within budget based on the same operations Main Generation already performs per request today.

### Q11 — Can Quick Ask stay stateless while AgentRun remains stateful?

**Quick Ask's *user-facing contract* stays stateless (no Response, no Loom mutation, no conversation state) while its *execution* gains a thin, optional layer of state (the `AgentRun` row) purely for audit.** These are not in conflict: "stateless" here describes the product/domain model (no durable conversational artifact), not the literal absence of any database row. The existing `agent_runs` table already stores executions with no `response_id` (`response_id: Option<String>`) — Quick Ask runs would simply always take that `None` branch.

### Q12 — Should there be two AgentRun modes? (`FullConversation` / `LightweightQuickAsk`)

**Yes — this is the central recommendation of this document.** See §5 (Recommendation) for the full rationale. In brief: a single `AgentRunMode` enum on `AgentRuntimeRequest` (or equivalently, a parallel lightweight constructor path) that the runtime switches on to decide which steps/events to emit, without forking the entire `AgentRuntime` implementation.

### Q13 — If `LightweightQuickAsk` exists, which lifecycle states disappear?

Relative to the full `execute_run` state machine, `LightweightQuickAsk` mode drops:
- `StepStarted`/step persistence for `ContextBuild`, `ProviderCall`, `ToolCallPlaceholder`, `ArtifactPlaceholder`, `ValidationPlaceholder` — none of these phases exist as separate steps; there is exactly one undivided phase.
- `ProviderDelta` events — Quick Ask's provider call is non-streaming; there is no delta stream to report, only a single terminal outcome.
- `ToolCallRequested`/`ToolPermissionEvaluated`/`ToolCallSkipped` — the placeholder tool-call probe Main Generation currently runs unconditionally (and which always resolves to "skipped, not implemented" today, since the Tool Registry's seeded descriptors are all `NotAvailable`) has no reason to run for a mode that explicitly never reaches the Tool Scheduler (Q15).
- `ArtifactCreated` — no artifact phase exists.
- Cancellation race-condition handling around a live SSE stream — `LightweightQuickAsk` wraps one blocking, non-cancellable-mid-flight provider call (Quick Ask today has no mid-request cancel signal of its own; it returns or it doesn't). Cancellation support can be added later if Quick Ask's transport ever becomes streaming, but is out of scope now since it would not match current behavior.

What survives: `RunStarted` (now folded with `RunCreated` into a single combined insert+event, see §5), exactly one terminal event (`RunCompleted`/`RunFailed`), and `ProviderRuntimeService` lifecycle tracking around the one provider call (Q14).

### Q14 — Should ProviderRuntime still be used?

**Yes, unconditionally.** `ProviderRuntimeService` is metadata-only (per its own static-source guard test, it never performs provider I/O) and is now wired as a thin lifecycle-tracking layer around both Main Generation's and `AgentRuntime`'s real provider calls (`PROVIDER-RUNTIME-BRIDGE-001`). Quick Ask's single provider call should get the same `submit_noop → transition_to_running → complete_execution|fail_execution` treatment, using the same static safe codes pattern (never a dynamic error-kind string, to avoid the forbidden-marker collision risk already documented in `Task_PROVIDER-RUNTIME-BRIDGE-001_v1.0.md`). This is cheap (in-memory `HashMap` operations behind an `RwLock`, no I/O) and gives Quick Ask the same provider-execution audit trail as every other path, for negligible cost.

### Q15 — Should ToolScheduler ever be reachable from Quick Ask?

**No, not in this design, and not until there is an explicit product reason.** Quick Ask's value proposition is a single fast question/answer with no side effects. Reaching the Tool Scheduler implies permission evaluation, possible external state mutation, and non-trivial latency variance (P20's `TOOL-SCHEDULER-IMPLEMENTATION` epic is still active/unimplemented as of this writing) — all directly opposed to Quick Ask's purpose. If a future product need arises (e.g. "quick tool-augmented lookup"), it should be a distinct, explicitly-named surface, not a quiet capability addition to Quick Ask.

### Q16 — Should Quick Ask be allowed to create durable state, or must it remain completely ephemeral?

**Allowed to create exactly one piece of durable state — its own `AgentRun` audit row (and the 2-3 events in Q3) — and nothing else.** "Completely ephemeral" was true of Quick Ask's *product* behavior before any AgentRun integration and remains true after: no Response, no Loom mutation, no Reference/Capsule/Memory/Snapshot (Q5). The `AgentRun` row is infrastructure-layer audit metadata, analogous to a structured log line, not product state. This distinction — durable audit metadata vs. durable product state — is the same one `docs/agent_runtime_contracts.md` §11 draws between "Run, Step, and durable Event history" (owned by Agent repositories) and "Final visible response content" (owned by Response repository); Quick Ask populates the former and continues to have nothing in the latter.

---

## 2. Architecture

```
                         ┌─────────────────────────────────────────┐
                         │              api/ask.rs::quick()         │
                         │         (V1_SHIM — unchanged contract)   │
                         └───────────────────┬───────────────────────┘
                                              │
                       ┌──────────────────────┴──────────────────────┐
                       │   QuickAskAgentRunShim::start()              │
                       │   (new — mirrors MainGenerationAgentRunShim  │
                       │   in shape, not in weight)                   │
                       │   - INSERT agent_runs (mode=LightweightQuickAsk,
                       │     response_id=None)
                       │   - append run.created + run.started (1 write,
                       │     combined per Q13)
                       └──────────────────────┬──────────────────────┘
                                              │
                       ┌──────────────────────┴──────────────────────┐
                       │   existing quick_* helpers, UNCHANGED:       │
                       │   resolve_quick_ask_focus, quick_messages,   │
                       │   quick_user_prompt, quick_ollama_request    │
                       │   (no Context Manager, no retrieval, no DB)  │
                       └──────────────────────┬──────────────────────┘
                                              │
                       ┌──────────────────────┴──────────────────────┐
                       │   ProviderRuntimeService.submit_noop()       │
                       │   .transition_to_running()                   │
                       └──────────────────────┬──────────────────────┘
                                              │
                       ┌──────────────────────┴──────────────────────┐
                       │   ProviderPipeline::stream_chat()            │
                       │   (UNCHANGED — still stream:false single     │
                       │   blocking completion under the hood)        │
                       └──────────────────────┬──────────────────────┘
                                              │
                ┌─────────────────────────────┼─────────────────────────────┐
                │ success                     │ error                      │ (no cancel path — see Q13)
                ▼                             ▼
   ProviderRuntimeService          ProviderRuntimeService
     .complete_execution()           .fail_execution()
   QuickAskAgentRunShim.finish()    QuickAskAgentRunShim.finish()
   (1 write: finish_run +            (1 write: finish_run +
    terminal event)                   terminal event)
                │                             │
                └─────────────────────────────┘
                              │
                              ▼
                   api/ask.rs returns QuickAskResponse
                   (UNCHANGED response shape)
```

Total new durable writes per Quick Ask call: **2** (one combined create+start insert, one combined finish+terminal-event write) — versus Main Generation's current ~5-7 (`create_run`, 2× `transition_run`, `insert_step`+`finish_step` for the context step, context-built event, then the provider step's insert/finish, plus the terminal write). This asymmetry is intentional and is the entire point of `LightweightQuickAsk` mode.

---

## 3. Sequence Diagram

```
User          api/ask.rs        QuickAskAgentRunShim   ProviderRuntimeService   ProviderPipeline   AgentRunRepository
 │  POST /ask/quick │                    │                       │                    │                  │
 │ ───────────────> │                    │                       │                    │                  │
 │                  │ start(mode=Lightweight)                    │                    │                  │
 │                  │ ─────────────────> │                       │                    │                  │
 │                  │                    │  insert_run + run.created/run.started (1 write)               │
 │                  │                    │ ────────────────────────────────────────────────────────────> │
 │                  │ <───────────────── │                       │                    │                  │
 │                  │ resolve_quick_ask_focus / quick_messages / quick_ollama_request (unchanged)         │
 │                  │                    │                       │                    │                  │
 │                  │ submit_noop + transition_to_running        │                    │                  │
 │                  │ ───────────────────────────────────────────> │                  │                  │
 │                  │                    │                       │                    │                  │
 │                  │ stream_chat(provider_request)  [stream:false]                   │                  │
 │                  │ ──────────────────────────────────────────────────────────────> │                  │
 │                  │ <────────────────────────────────────────── single completion event ───────────────│
 │                  │ complete_execution / fail_execution         │                    │                  │
 │                  │ ───────────────────────────────────────────> │                  │                  │
 │                  │ finish(shim) — finish_run + terminal event (1 write)            │                  │
 │                  │ ─────────────────────────────────────────────────────────────────────────────────> │
 │ <─────────────── │ QuickAskResponse (unchanged shape)          │                    │                  │
```

No SSE/streaming hop exists in this diagram because Quick Ask's provider call is not streamed today and this design does not change that.

---

## 4. State Diagram — `LightweightQuickAsk` AgentRun

```
            ┌─────────┐
   start ──>│ Created │
            └────┬────┘
                 │ (folded into one durable write with the line below)
            ┌────▼────┐
            │ Running │  (run.started; provider call in flight)
            └────┬────┘
        ┌─────────┼─────────┐
   success      failure   (no cancellation path in this mode — see Q13)
        │             │
   ┌────▼────┐   ┌────▼───┐
   │Completed│   │ Failed │
   └─────────┘   └────────┘
```

Compare to the full `FullConversation` mode state diagram (existing `execute_run`), which has five intermediate step states (`ContextBuild`, `ProviderCall`, `ToolCallPlaceholder`, `ArtifactPlaceholder`, `ValidationPlaceholder`) each with their own started/completed/failed/skipped substates, plus a `Cancelled` terminal reachable from a live cancellation signal mid-stream. `LightweightQuickAsk` collapses all of that to two states between start and terminal.

---

## 5. Recommendation — Canonical Architecture

**Adopt a single `AgentRuntime` implementation with two `AgentRunMode` variants — `FullConversation` (existing `execute_run` behavior, used by Main Generation, unchanged) and `LightweightQuickAsk` (new, used by Quick Ask) — rather than a second, parallel runtime implementation.**

### Why this, and not the alternatives

Three architectures were considered:

1. **Two separate runtime structs** (`AgentRuntime` for Main Generation, a new `QuickAskRuntime` for Quick Ask). Rejected: this duplicates the run-store/cancellation-signal/repository-persistence plumbing (`AgentRunStore`, `persist_event`, `finish_run_in_repo`, etc.) that has nothing to do with the conversation-vs-quick-ask distinction. Every future fix to event persistence or privacy sanitization would need to land twice.
2. **No AgentRun integration for Quick Ask at all** (status quo, indefinitely). Rejected: this leaves Quick Ask permanently invisible to the Agent Run audit/inspector surface and blocks any future incremental capability (e.g., a lightweight tool lookup, should product ever want one) from having a consistent execution-identity story. It also means two genuinely different "what counts as an execution" models persist in the codebase forever, which is exactly the kind of V1/V2 drift `docs/loom_v1_v2_boundary_audit.md` was written to prevent.
3. **One mode that always does the full state machine, with steps/events optionally skipped via per-step "should I record this" flags scattered through `execute_run`.** Rejected: this is the same outcome as the `AgentRunMode` enum but implemented as conditionals threaded through every branch of an already-1500-line function, rather than as a single dispatch at the top. It is strictly worse for maintainability for the same behavior.

The `AgentRunMode` enum approach wins because:
- It reuses 100% of the existing, tested run-store/cancellation/repository-persistence infrastructure (`AgentRunStore::insert`/`transition_terminal`, `persist_event`, `finish_run_in_repo`) — none of that code is mode-specific.
- It makes the step/event reduction (Q13) an explicit, single switch at the start of `execute_run` (or a small `LightweightQuickAsk`-specific code path inside the same function/module) rather than scattered conditionals.
- It keeps exactly one place (`agent_runtime/runtime.rs`) responsible for "what does an AgentRun lifecycle look like," which is the same principle `docs/loom_v1_v2_codeboundary_marking.md` already applies to keep V1/V2 ownership unambiguous.
- It composes cleanly with `ProviderRuntimeService` (Q14) and the existing `AgentRunRepository` schema — `AgentRun.response_id: Option<String>` and the existing nullable/optional fields already accommodate a run with no Response, no context snapshot, and no steps without any schema change.
- The latency cost is bounded and measurable (§6), because the lightweight path is the *same* runtime minus most of its writes, not a new system whose overhead is unknown.

### What this recommendation explicitly does NOT do

- It does not give Quick Ask a context path, References, Capsules, Memories, or Snapshots (Q4, Q5).
- It does not make Quick Ask streaming, cancellable mid-flight, replayable, branchable, or Weft-aware (Q7, Q8, Q9, Q13).
- It does not make Quick Ask reachable from the Tool Scheduler (Q15).
- It does not change `api/ask.rs`'s public request/response contract, latency profile, or any frontend behavior. This document does not implement any of the above — see §7 for the migration path that would.

---

## 6. Performance Comparison

| Dimension | Quick Ask today (V1) | Quick Ask under `LightweightQuickAsk` (proposed) | Main Generation (`FullConversation`, current) |
|---|---|---|---|
| Repository writes per call | 0 | 2 (combined create+start; combined finish+terminal event) | ~5-7 (run create, 2 transitions, context step ×2, context-built event, provider step ×2, terminal write) |
| Durable events per call | 0 | 2-3 (`run.created`+`run.started` combined, 1 terminal) | ~5 (`run_created`, `run_queued`, `run_started`, `main_generation_context_built`, 1 terminal) |
| Context/Knowledge Layer work | none | none (unchanged) | legacy `ContextManager` + 7 contributors |
| Provider transport | non-streaming, single blocking completion | unchanged (non-streaming) | streaming SSE |
| `ProviderRuntimeService` overhead | none today | ~3 in-memory `RwLock` map operations (no I/O) | same, already shipped |
| Estimated added latency | — (baseline) | **<5ms p50, <15ms p99** (2 SQLite inserts on an already-open pool; same per-row cost Main Generation already pays per request) | already paid today |
| Cancellable mid-flight | no | no (unchanged) | yes (cancellation signal + dual-path cancel) |
| Appears in Agent Run history | no | yes (experimental/debug surface only) | yes |

The proposed overhead is small because it is *only* two single-row SQLite inserts against a connection pool the service already keeps warm for every other request — the same class of operation Main Generation's shim already performs several times per call today with no reported latency regression. There is no new context-building, retrieval, or streaming-protocol work added at any point.

---

## 7. Migration Strategy

This document authorizes no implementation. The following sequencing is recommended for a future implementation task, in order:

1. **`QUICK-ASK-AGENTRUN-MODE-001`** (new) — add the `AgentRunMode` enum (`FullConversation` | `LightweightQuickAsk`) to `agent_runtime/types.rs`, threaded through `AgentRuntimeRequest`. Add the reduced step/event code path inside `execute_run` (or a sibling function sharing the run-store/repository plumbing) gated on the mode. No caller changes yet — covered by unit tests exercising `LightweightQuickAsk` directly against the existing `AgentRuntime` test harness (`make_test_runtime`), mirroring the pattern `AGENT-RUNTIME-CONTEXT-CONSUMPTION`-era tests already use.
2. **`QUICK-ASK-AGENTRUN-SHIM-001`** (implementation, behind a feature flag) — add `QuickAskAgentRunShim` to `api/ask.rs`, mirroring `MainGenerationAgentRunShim`'s shape (per §2) but calling into the `LightweightQuickAsk` path. Gate behind an explicit flag (e.g. `LOOM_QUICK_ASK_AGENT_RUN_SHIM`) so it can ship dark, be measured against the §6 latency budget under real traffic, and be reverted instantly if the budget is exceeded.
3. **Measurement window** — compare p50/p99 latency of `/ask/quick` with the flag on vs. off in a real deployment before defaulting it on. This is the gate that actually validates §6's estimate rather than assuming it.
4. **Default-on** — once measured safe, remove the flag and make `QuickAskAgentRunShim` unconditional, matching Main Generation's current unconditional shim.
5. **No further phases are currently justified.** Unlike Main Generation (which has a multi-phase path toward eventually retiring the direct `ProviderPipeline` loop in favor of full `AgentRuntimeService::execute` dispatch, per `docs/context_pipeline_agent_integration_design.md` §5), Quick Ask's target state *is* `LightweightQuickAsk` — there is no planned future phase that gives it context, steps, or tools, because doing so would contradict its product purpose. Any future capability expansion should be re-scoped as a new, explicitly-named surface (per Q15), not a Quick Ask phase.

---

## 8. Risks

1. **Latency regression if the budget in §6 is wrong.** Mitigated by shipping behind a flag and measuring before defaulting on (migration step 3) — this is the single most important risk control in this design.
2. **Scope creep toward giving Quick Ask context/steps "since the plumbing is already there."** The `AgentRunMode` enum makes it structurally easy to add a third mode or quietly expand `LightweightQuickAsk`'s scope later. Guard: any future PR that adds a context path, step, or durable artifact to the `LightweightQuickAsk` mode should be treated as a product decision requiring explicit sign-off, not a routine engineering addition — mirroring the existing `V1_DEPRECATED_NO_NEW_FEATURES` discipline already applied to `api/orchestration.rs`.
3. **`ProviderRuntimeService` forbidden-marker collisions.** Already encountered once in `PROVIDER-RUNTIME-BRIDGE-001` (dynamic `ProviderErrorKind` debug strings could contain `"secret"`). The same static-safe-code discipline must be applied to Quick Ask's bridge calls from day one of implementation.
4. **Agent Run history surface exposing Quick Ask volume.** Quick Ask is the highest-frequency endpoint in the system; once it appears in `agent_runs`, that table's row count grows much faster. This is acceptable (it's exactly the kind of audit trail the table exists for) but should be flagged to whoever owns the experimental Agent Run Inspector UI so pagination/retention assumptions account for the new volume.
5. **Flag-off/flag-on behavioral drift during the measurement window.** Two code paths existing simultaneously (flagged) is itself a small maintenance burden; keep the measurement window short and decisive rather than leaving the flag in place indefinitely.

---

## 9. Files Created

- `docs/quick_ask_agentrun_design.md` (this document).

## 10. ROADMAP STATUS

**Current Phase**: P20 Multi-Agent Execution Topology
**Current Epic**: V1/V2 Boundary & Provider Bridge Sequencing (still pending formal registration in `docs/loom_master_roadmap.md` §3 — flagged previously in `docs/context_pipeline_flow_audit.md` §13 and not yet resolved)
**Current Task**: `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001` — completed this turn (design only; no implementation task started)

No runtime code, frontend code, or API behavior was modified in producing this document.
