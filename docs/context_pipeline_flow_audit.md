# Context Pipeline Flow Audit v1.0

Status: AUDIT COMPLETE — design/docs only, no runtime code changed
Task: `CONTEXT-PIPELINE-FLOW-AUDIT-001`

## 1. Executive Summary

This audit traces the real, current call paths for Main Generation, Quick Ask, attachments, capsules/checkpoints/Weft, Context Snapshot, and provider execution, with file:line citations, before any further V1→V2 bridge work proceeds.

The single most important finding: **the "Knowledge Layer" pipeline that the roadmap and prior design docs treat as canonical and locked — `ContextSelectionService` → `AgentContextManager` → `ContextSnapshot` — has zero production callers today.** Neither Main Generation (`api/orchestration.rs`) nor Quick Ask (`api/ask.rs`) nor the experimental `AgentRuntime` invokes it. Main Generation instead runs an older, separate path: the legacy `ContextManager` (`context/manager.rs`) with its own `ContextContributor` implementations that fetch content inline. This means `CONTEXT-SELECTION-SERVICE-001`, `AGENT-CONTEXT-MANAGER-001`, and the Context Snapshot tasks are fully built and tested (correctly marked `LOCKED` in `docs/loom_master_roadmap.md` P15/P16 — those tasks did exactly what they specified), but the subsystem they built is **orphaned infrastructure with no production traffic**, not a path the live app currently exercises.

A second major finding: `AgentRuntime::execute_run()` (the V2 runtime) does not build context at all — it sends a single hardcoded user-role message built directly from `request.prompt`, with `contextBuilt: false` hardcoded into the request metadata. It has no awareness of capsules, checkpoints, Weft origin context, memory, attachments, or references.

Combining these two findings changes the risk profile of `MAIN-GENERATION-AGENTRUN-SHIM-001` substantially: shimming Main Generation onto `AgentRun` today, as literally specified by the existing design docs, would silently drop every context-rich behavior Main Generation currently has (recent turns, capsules, checkpoints, Weft origin context, memory, attachments, references) and would for the first time route real user traffic through a Context Selection/Agent Context Manager pipeline that has never seen production load. §8 and §9 below give a revised, safer sequence that closes both gaps before any shim ships.

`PROVIDER-RUNTIME-BRIDGE-001` remains correctly on-hold: `ProviderRuntimeService` (`provider_runtime.rs`) is confirmed fully disconnected (only 8 references, all inside its own unit tests) and is metadata-only — it has no method that actually calls a provider. Bridging `AgentRuntime` to it today would add a hop that does not yet do anything; the seam needs to actually wrap `ProviderPipeline::stream_chat` before a bridge is useful.

## 2. Main Generation Flow (`POST /orchestration/execute`)

Entry point: `api/orchestration.rs:145` `pub async fn execute()` (marked `V1_SHIM`).

Call order:
1. `execute()` (orchestration.rs:145) → `execute_stream()` (orchestration.rs:3271)
2. `create_persisted_response_lifecycle()` (orchestration.rs:1119, called at :3333) — persists the user message and a placeholder assistant Response row via the Responses repository; returns `PersistedResponseLifecycle { user_response_id, assistant_response_id, .. }`.
3. `resolve_context_scope()` (:3387–3399) — determines whether this is a Weft Loom or an origin Loom.
4. `context_window_for_execution()` (:3401–3419) — builds the recent-turns window.
5. `attached_references_for_sources()` (orchestration.rs:1908, called at :3425–3438) — resolves explicit `#` References attached to the prompt.
6. `memory_messages_for_execution()` (orchestration.rs:2546, called at :3481) — fetches memory context messages from `MemoryRepository`.
7. `ContextManager::build_context_with_repositories_and_strategy()` (context/manager.rs:87, called at orchestration.rs:3530–3532) — **this is the legacy `ContextManager`, not `ContextSelectionService` and not `AgentContextManager`.** It runs `ContextRetriever::retrieve_with_strategy()` directly and assembles `ContextContributor`s (see §5) into a `BuiltContext`.
8. `create_provider_pipeline_for_request()` (orchestration.rs:3239, called at :3763–3769) — builds the `ProviderPipeline`.
9. A `ProviderContractRequest` is constructed (:3817–3865) from the `BuiltContext` messages.
10. `provider_pipeline.stream_chat(provider_request)` (:3867–4062) — streams the completion; each delta is persisted incrementally via `update_persisted_assistant_content()` (called inside the loop, :3894).
11. On completion: `update_persisted_assistant_status()` + `ResponseRepository::update_response_inference_metadata()` (:3927–3943) finalize the assistant Response row (status, token counts).
12. `schedule_context_artifact_job()` (orchestration.rs:1835, called at :3945, :3990, :4018, :4051) — schedules the Weft/capsule/checkpoint side-effect work that follows persistence (see §5 for whether this is sync or async).

**Confirmed by grep: zero references to `ContextSelectionService`, `AgentContextManager`, or `AgentRuntimeService` anywhere in `orchestration.rs`.** Main Generation today is a fully self-contained V1 path from HTTP entry to persisted Response; it does not touch any part of the "Knowledge Layer" pipeline that Phase P15/P16 built.

## 3. Quick Ask Flow (`POST /ask/quick`)

Entry point: `api/ask.rs:268` `pub async fn quick()` (marked `V1_SHIM`).

Call order:
1. `quick()` (:268) → `resolve_quick_ask_focus()` (ask.rs:1032, called at :289) — pure computation (focus subject, topic, constraints extraction from the request); **no repository calls**.
2. `quick_ollama_request()` (ask.rs:2093, called at :296) — builds a request envelope; still no database involvement.
3. `quick_answer_from_provider_adapter()` (ask.rs:481, called at :298) → `ProviderPipeline::new().default_generation_profile()` (:485–486) → `quick_provider_request_from_ollama_request()` (ask.rs:500, called at :487–491) → `provider_pipeline.stream_chat(provider_request)` (:492) — direct provider call, no context building of any kind.
4. `collect_quick_answer_from_provider_events()` (ask.rs:554, called at :497) — collects visible-text deltas into the final answer string; thinking deltas are discarded, not persisted.

**Confirmed: Quick Ask touches no repository at all** (zero `MemoryRepository`/`ContextArtifactsRepository`/`ReferenceRepository`/retrieval calls), persists nothing to SQLite, and does not call `ContextSelectionService`, `HybridRetrievalService`, or `AgentRuntimeService`. This is intentional fast-path design (per `docs/context_pipeline_agent_integration_design.md` §6: Quick Ask "bypasses deep Context Selection" — true today because it bypasses *all* context work, not a partial subset) and must be preserved, not just "reduced," by any future shim.

## 4. Attachment Flow

`AttachmentRepository` (`storage/repositories/attachments.rs`):
- `get_attachment(attachment_id)` (:290) — returns merged content from `attachment_parsed_content.content_text` / `attachment_parse_artifacts.content_text`, with `compressed_text` as an alternative encoding.
- `get_attachment_blob(attachment_id)` (:362) — raw original bytes; cross-Loom access blocked.
- `get_referenced_attachment_content(loom_id, attachment_id, query)` (:415) — returns only the chunks matching `query` within `ATTACHMENT_CONTEXT_CHAR_BUDGET`, via `select_relevant_chunks()`; **not the full attachment text**.
- `parse_attachment_now(attachment_id, updated_at)` (:452) — triggers (re)parsing/OCR.

Where raw content lives: `attachment_parsed_content` / `attachment_parse_artifacts` tables, field `content_text` (plus `compressed_text`).

Identity-only vs. content boundary (in the Knowledge Layer path, which — per §2/§3 — Main Generation and Quick Ask do not currently use):
- `retrieval/hybrid_service.rs` `RetrievalCandidate` (:91–103) carries `source_kind`, `source_id`, `chunk_ref`, `relevance_score`, optional `text_preview` — **no content field**.
- `context_selection.rs::transform_retrieval_candidate()` (:949–1025) validates attachment-chunk existence via a `COUNT(*)` metadata query (:994–1007) — never fetches content.
- Full content is fetched only in `agent_context_manager.rs::resolve()` (:307–388, specifically :345–353), via `SELECT c.content_text FROM attachment_parse_artifact_chunks ... WHERE c.chunk_id = ?1`.

This identity-then-resolve boundary is real and correctly implemented **inside the Knowledge Layer subsystem**. But Main Generation's actual attachment path goes through `attached_references_for_sources()` and the legacy `ContextManager`'s `AttachedReferencesContributor` (§5), which fetches content directly and does not pass through this identity-only gate at all. There are, today, **two different attachment-content-access patterns in the codebase**, and only one of them is exercised by real traffic.

## 5. Capsule / Checkpoint / Weft / Reference Flow

Repository methods (`storage/repositories/context_artifacts.rs`):
- Response Capsules: `upsert_response_capsule()` (:190) writes title/summary/key_points/keywords/entities/code_blocks JSON to `response_context_capsules`; `get_response_capsule()` (:260) reads the latest one for a Response.
- Loom Checkpoints: `upsert_loom_checkpoint()` (:276) writes to `loom_checkpoint_summaries`; `get_latest_checkpoint_for_loom()` (:342) reads the most recent by `updated_at DESC`.
- Weft Origin Context: `upsert_weft_origin_context()` (:361) writes `origin_summary` to `weft_origin_contexts`; `get_weft_origin_context()` (:412) reads the latest for a Weft Loom.

`ContextContributor` implementations (`context/contributors.rs`): `RecentTurnsContributor` (:60), `ProfileMemoryContributor` (:101), `LoomCheckpointContributor` (:135), `WeftOriginContributor` (:173), `AttachedReferencesContributor` (:206), `ResponseCapsuleContributor` (:238), `RetrievedMemoryContributor` (:283). These are exactly the contributors the legacy `ContextManager` (§2 step 7) assembles into `BuiltContext` for Main Generation — **this is how Main Generation actually gets capsules/checkpoints/Weft origin context/References/memory into the prompt today.**

Creation timing: the `upsert_*` repository methods themselves are synchronous calls. Whether capsule/checkpoint creation after a Response is persisted runs inline or via a queued job is determined by the caller, not the repository — `context_artifacts.rs` also exposes an `insert_job()` method (:431–450) against a `context_build_jobs` table, and Main Generation's `schedule_context_artifact_job()` (§2 step 12) is the caller that decides. Treat capsule/checkpoint creation as **scheduled after Response persistence, asynchronously from the user-visible stream completing**, but confirm exact job-execution timing against `context/worker.rs` before relying on this for a sequencing decision — it was not fully read in this audit.

## 6. Context Snapshot Flow

`context_snapshots.rs` defines two record shapes:
- `ContextSnapshotRecord` (:35–49): `snapshot_id, agent_run_id, loom_id, response_id, scope_context_id, created_at, policy_version, selection_version, budget_json, diagnostics_json, candidate_count, selected_count, rejected_count`.
- `ContextSnapshotCandidateRecord` (:53–69): `snapshot_candidate_id, snapshot_id, source_kind, source_id, chunk_ref, tier, include_mode_hint, estimated_tokens, retrieval_score, final_rank, is_mandatory, is_hidden_background, is_selected, rejection_reason, metadata_json`.

Snapshot writes are split across two callers:
1. `context_selection.rs::persist_snapshot()` (:1051) creates the parent row plus initial (not-yet-finalized) candidate rows, via `create_snapshot_with_candidates()` (:1108–1109), gated on `request.persist_snapshot = true` (:621).
2. `agent_context_manager.rs::finalize_snapshot()` (:453) updates the candidate rows with final `include_mode_hint`/`estimated_tokens`/`is_selected`/`rejection_reason` and the parent row's final budget/diagnostics, via `finalize_context_manager()` (:484–485).

Linkage: `storage/repositories/agent_runs.rs::link_context_snapshot()` (:824–879) writes `agent_runs.context_snapshot_id`.

**This entire two-phase create/finalize/link flow is correctly designed per `docs/agent_runtime_contracts.md` §10 (content-free snapshot, identity+score+inclusion-status only).** But per §2 and §7, neither caller (`ContextSelectionService::select()` nor `AgentContextManager::build()`) is invoked by Main Generation, Quick Ask, or the current `AgentRuntime`. The only confirmed callers are the test suites inside the Knowledge Layer modules themselves. **No context_snapshots row is created by any live request path today.**

## 7. Provider Flow

Three independent provider-call sites exist:

1. **Main Generation**: `create_provider_pipeline_for_request()` builds a `ProviderPipeline`; `provider_pipeline.stream_chat(provider_request)` is called with a request built from the legacy `ContextManager`'s `BuiltContext`. Cancellation: `ProviderPipeline::cancel_generation(request_id)` (`providers/pipeline.rs:125`) forwards directly and synchronously to the adapter registry — no run-state tracking.

2. **Quick Ask**: `ProviderPipeline::new().default_generation_profile()` then `stream_chat()` directly with a thin request derived from `OllamaChatRequest`. Same fire-and-forget cancellation primitive, not separately wired for Quick Ask's abort signal in this trace (not confirmed either way — out of scope for this pass).

3. **AgentRuntime** (`agent_runtime/runtime.rs::execute_run()`, :325, calling `pipeline.stream_chat(provider_request)` at :447): holds its own `ProviderPipeline<R>` field (:256) and calls it **directly, bypassing `ProviderRuntimeService` entirely** — confirmed by zero `ProviderRuntimeService` references anywhere in `agent_runtime/`. The `ProviderContractRequest` it builds (:420–444) is a single hardcoded user-role message copied from `request.prompt`, with `loom_context_metadata: { "contextBuilt": false, "contextSnapshotId": request.context_snapshot_id }` — i.e., **no context assembly happens in AgentRuntime today**; it only passes through a `context_snapshot_id` if one was supplied externally, it never creates one. Cancellation here is dual-path: `AgentRuntime::cancel_run()` (:306–316) first transitions run state via `run_store.request_cancel()`, then calls `pipeline.cancel_generation()` as a secondary, best-effort signal — structurally different from Main Generation/Quick Ask's single fire-and-forget call.

`ProviderRuntimeService` (`provider_runtime.rs`) itself: confirmed **fully disconnected / dead in production** — its 8 references are all inside its own unit tests. Its public surface (`submit_noop`, `transition_to_queued`, `transition_to_running`, `complete_noop`, `fail_execution`, `cancel_execution`, `timeout_execution`, `skip_execution`, all :269–395) is a metadata-only state machine. **It has no method that calls a provider.** `PROVIDER-RUNTIME-BRIDGE-001` as currently scoped ("hook `AgentRuntime` to `ProviderRuntimeService`") would connect `AgentRuntime` to something that still does not make a real provider call — the bridge needs `ProviderRuntimeService` to actually wrap `ProviderPipeline::stream_chat` internally, which is not yet designed, before the bridge has any functional effect.

## 8. V1/V2 Integration Risks

1. **Context regression risk (severe).** Main Generation's real content path is the legacy `ContextManager` + its 7 contributors (§5). `AgentRuntime` has no equivalent today (§7). If `MAIN-GENERATION-AGENTRUN-SHIM-001` ships as literally specified — "hollow out `api/orchestration.rs` to wrap `AgentRun`" — before `AgentRuntime` can reproduce recent turns, capsules, checkpoints, Weft origin context, memory, attachments, and References, every Main Generation response routed through the shim loses all of that context. This is not a neutral refactor; it is a functional regression disguised as plumbing.

2. **Untested-in-production risk.** `ContextSelectionService`/`AgentContextManager`/Context Snapshot are fully built, unit-tested, and marked `LOCKED` (P15/P16) — but have never processed a real request (§2, §3, §6). Routing either Main Generation or `AgentRuntime` onto this path for the first time means the first production traffic this subsystem ever sees arrives bundled with a second, simultaneous architectural migration (the AgentRun shim itself). If something breaks, it will be hard to tell which of the two changes caused it.

3. **Non-functional bridge risk.** `ProviderRuntimeService` is metadata-only with no real provider-call capability (§7). Building `PROVIDER-RUNTIME-BRIDGE-001` against it today produces a bridge to nowhere — functionally identical to the current direct `ProviderPipeline` call, but with extra indirection and no added safety, since the "safety" (event normalization, redaction, execution records) the seam audit attributes to `provider_runtime.rs` is never exercised in any call that actually streams a real response.

4. **Two-cancellation-model risk.** Main Generation/Quick Ask use a single fire-and-forget `cancel_generation()` call; `AgentRuntime` uses a dual-path state-machine-then-signal model (§7). A shim that exposes the legacy `/orchestration/cancel/:runId` or Quick Ask's abort signal on top of `AgentRun` execution must explicitly decide how the two map onto each other — getting it wrong risks either an `AgentRun` left non-terminal while its underlying stream is actually dead, or the reverse.

5. **Quick Ask write-amplification risk.** Quick Ask currently persists nothing and builds no context (§3) — that is its entire value proposition (fast, cheap, ephemeral). `docs/context_pipeline_agent_integration_design.md` §6 proposes Quick Ask "will still generate a minimal `ContextSnapshot` for auditability" once shimmed onto a lightweight `AgentRun`. That is new DB write volume on the highest-frequency, most latency-sensitive endpoint in the system, and is not yet justified against Quick Ask's actual call volume.

6. **Tool Registry non-executability risk.** `agent_runtime/catalog.rs` seeds exactly 4 tool descriptors (`loom.runtime.status`, `loom.loom.inspect`, `loom.weft.inspect`, `loom.response.read`, :37–95), all explicitly `ToolAvailability::NotAvailable`, with a code comment confirming "no handlers and cannot execute tools" (:5). This independently resolves `docs/loom_master_roadmap.md` §5 drift case 4: the registry-as-data-structure is seeded (justifying the ledger's "seed shipped" claim) but is intentionally non-executable (justifying the Task files' 0%-complete claim about a *working* registry) — these were never actually contradictory, just two different definitions of "done." `TOOL-SCHEDULER-DESIGN-001`/`TOOL-SCHEDULER-IMPLEMENTATION` (P20, currently `ACTIVE`) depends on this registry becoming executable, which it is not yet.

7. **Content-boundary blur risk.** The identity-only retrieval/selection boundary (§4) is correctly enforced *inside* the Knowledge Layer subsystem, but Main Generation's actual attachment path (legacy `ContextManager` contributors) fetches content inline with no such gate. Any future work that tries to "merge" these two attachment paths must not casually copy the legacy pattern's direct-fetch style into the Knowledge Layer's identity-only candidates, or vice versa apply the Knowledge Layer's stricter gate to the legacy path in a way that silently drops attachment content Main Generation currently includes.

## 9. Safe Integration Sequence

The task's proposed order (`CONTEXT-PIPELINE-AGENT-INTEGRATION-SPEC-001?` → `MAIN-GENERATION-AGENTRUN-SHIM-001?` → `PROVIDER-RUNTIME-BRIDGE-001?` → `QUICK-ASK-AGENTRUN-SHIM-001?`) is not safe as literally ordered, because it ships the shim before `AgentRuntime` can build context (Risk 1) and before the Knowledge Layer has any production track record (Risk 2). Recommended revised order:

1. **`CONTEXT-PIPELINE-AGENT-INTEGRATION-SPEC-001`** — amend the existing design doc (`docs/context_pipeline_agent_integration_design.md`) to explicitly decide one open question it currently leaves implicit: does the Main Generation shim call the legacy `ContextManager` (preserving exact current behavior, lowest risk) or cut over to `ContextSelectionService`/`AgentContextManager` (the originally intended target, higher risk, never-production-tested) at shim time? This audit recommends **the legacy `ContextManager` first** — ship the shim with zero context-behavior change, and treat cutting Main Generation's context source over to the Knowledge Layer pipeline as a distinct, later, separately-reviewed task once that pipeline has run in production via some other path.
2. **`AGENTRUN-CONTEXT-CONSUMPTION-001`** (new, not yet in the task list) — teach `AgentRuntime::execute_run()` to accept a pre-built context payload (sourced per decision in step 1) instead of its current hardcoded single-message `request.prompt`. This must land before any shim routes real user traffic through `AgentRuntime`, closing Risk 1/Risk 2 directly.
3. **`MAIN-GENERATION-AGENTRUN-SHIM-001`** — only after step 2. Ship as a synchronous/blocking shim (per the existing design doc's "Phase B"), preserving the current SSE contract and `context_snapshot_id` continuity, with an explicit fallback to the direct `ProviderPipeline` path if `AgentRun` execution fails — because this is the first time this code path carries production traffic.
4. **`PROVIDER-RUNTIME-BRIDGE-001`** — only after confirming/extending `ProviderRuntimeService` to actually wrap a real `ProviderPipeline::stream_chat` call internally (closing Risk 3). Bridging to it before that is complete produces no functional change.
5. **`QUICK-ASK-AGENTRUN-SHIM-DESIGN-001`** — design only; must explicitly resolve the Risk 5 write-amplification question (does the "lightweight AgentRun" actually write a Context Snapshot row per request, or is Quick Ask an explicit, documented exception to the "every run gets a snapshot" rule?) before any implementation task is created.
6. **`QUICK-ASK-AGENTRUN-SHIM-001`** (implementation) — only after step 5's design resolves the snapshot-write question, and only after step 3 has run in production long enough to be trusted; Quick Ask is higher-frequency and more latency-sensitive than Main Generation and should not be the first place this new infrastructure is load-tested.

Independent of this sequence: making the 4 seeded tool descriptors (Risk 6) executable is not on this critical path today, but `TOOL-SCHEDULER-IMPLEMENTATION` (P20, currently `ACTIVE`) will need it — track it in parallel, not blocking steps 1–6 above.

## 10. Required Bridge Tasks

- `CONTEXT-PIPELINE-AGENT-INTEGRATION-SPEC-001` — amend existing design doc per §9 step 1's explicit decision.
- `AGENTRUN-CONTEXT-CONSUMPTION-001` — new task, not previously listed anywhere; required before any shim.
- `MAIN-GENERATION-AGENTRUN-SHIM-001` — as previously planned, but gated on the above two.
- `PROVIDER-RUNTIME-BRIDGE-001` — remains correctly on-hold; additionally needs `ProviderRuntimeService` extended to wrap real provider calls before the bridge itself is meaningful.
- `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001` then `QUICK-ASK-AGENTRUN-SHIM-001` — design must resolve the snapshot-write question before implementation is scheduled.
- `TOOL-REGISTRY-EXECUTABILITY-001` (new, recommended, not on this critical path) — give the 4 seeded tool descriptors real handlers; required for `TOOL-SCHEDULER-IMPLEMENTATION` (P20) but independent of the context-pipeline sequence above.

## 11. Do-Not-Break List

- The SSE/NDJSON API contract for `/orchestration/execute` and `/ask/quick` — existing frontend clients depend on exact event shapes.
- `context_snapshot_id` continuity and history-polling behavior (per `docs/context_pipeline_agent_integration_design.md` §11) — any client already polling on this field must keep working.
- Weft origin context, capsule, and checkpoint inclusion in Main Generation responses — currently delivered by the legacy `ContextManager` contributors (§5); must not silently disappear before `AgentRuntime` can reproduce them (§9 step 2).
- Raw-thinking privacy invariant — already enforced at multiple boundaries (provider adapter, Context Snapshot, Agent Event log per `docs/agent_runtime_event_model.md` §6) — must hold through every layer touched by this sequence.
- Quick Ask's zero-persistence, zero-context, fast-path behavior — do not silently add latency or DB writes without an explicit, reviewed decision (§9 step 5).
- The two distinct provider-cancellation semantics (§7) — do not leave a run half-migrated between the fire-and-forget model and the dual-path state-machine model.
- The content-identity boundary inside the Knowledge Layer (retrieval/selection never carrying content, §4) — do not blur it by merging it carelessly with the legacy `ContextManager`'s direct-fetch contributor pattern.

## 12. Final Recommendation

Do not begin `MAIN-GENERATION-AGENTRUN-SHIM-001` or `PROVIDER-RUNTIME-BRIDGE-001` yet. Both are correctly blocked — the task's premise that this audit should complete first was right. The two concrete unblocking actions are: (1) amend the integration spec to pick a context source for the shim (§9 step 1), and (2) create and complete a net-new `AGENTRUN-CONTEXT-CONSUMPTION-001` task so `AgentRuntime` can build a real context payload before it carries production traffic. `PROVIDER-RUNTIME-BRIDGE-001` additionally needs `ProviderRuntimeService` extended with a real provider-call wrapper before it does anything useful. None of this requires touching `api/orchestration.rs` or `api/ask.rs` yet, consistent with this task's no-runtime-changes constraint.

## 13. ROADMAP STATUS

**Current Phase**: P20 Multi-Agent Execution Topology

**Current Epic**: V1/V2 Boundary & Provider Bridge Sequencing — **note**: this epic does not yet exist as a named entry under P20 in `docs/loom_master_roadmap.md` §3; `CONTEXT-PIPELINE-FLOW-AUDIT-001` and its sibling tasks (`LOOM-V1-V2-BOUNDARY-AUDIT-001`, `LOOM-V1-V2-CODEBOUNDARY-MARKING-001`, `CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001`, `PROVIDER-RUNTIME-SEAM-001`) are referenced as locked/in-flight by this task's own brief but are not present in the roadmap's P20 Phase Tree, which currently only lists `MODEL-EXECUTION-TOPOLOGY-DESIGN-001`, `PROVIDER-CONCURRENCY-POLICY-DESIGN-001`, `SUBAGENT-RUNTIME-DESIGN-001`, `TOOL-SCHEDULER-DESIGN-001`, and the `TOOL-SCHEDULER-IMPLEMENTATION` epic. **This is itself a roadmap-vs-task drift case** per `docs/pm_operating_model.md` §7.6 rule 2 — flagging rather than silently editing the roadmap, since this task's scope is audit-only.

**Current Task**: `CONTEXT-PIPELINE-FLOW-AUDIT-001`

### PROGRESS

**Overall Project Progress**: Not recalculated in this audit — no Task/Test/QA checklist files exist yet for the V1/V2 boundary work this audit covers, so no physical checklist denominator is available. Do not invent a percentage.

**Current Phase Progress**: P20 is `ACTIVE, 30%` per `docs/loom_master_roadmap.md` §2 (unchanged by this audit; this task produced a document, not a checklist item against an existing Task file).

**Current Epic Progress**: N/A — epic not yet defined in the roadmap (see drift note above).

### REMAINING BIG BLOCKS

1. P20 Multi-Agent Execution Topology — `TOOL-SCHEDULER-IMPLEMENTATION` epic remains `ACTIVE` with 5 `NEXT` subtasks (schema, repository, runtime, permission model, artifacts).
2. P20 — V1/V2 boundary sequencing (this audit's findings) needs to be formally added to the roadmap as its own epic before further bridge tasks are scheduled.
3. P11 Tool Runtime & Registry — drift case 4 now has direct code evidence (§8 risk 6) and should be formally closed in the roadmap.

### CRITICAL PATH

- `AGENTRUN-CONTEXT-CONSUMPTION-001` (new) → `MAIN-GENERATION-AGENTRUN-SHIM-001` → `PROVIDER-RUNTIME-BRIDGE-001` (extended scope per §7) → `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001` → `QUICK-ASK-AGENTRUN-SHIM-001`

### ESTIMATED REMAINING WORK

Not calculated — no Task files with checklists exist yet for `AGENTRUN-CONTEXT-CONSUMPTION-001` or the amended integration spec; per `docs/pm_reporting_contract.md` §6, estimates require physical checklist counts, which do not yet exist for this newly-identified work. Creating those Task files is itself part of the recommended next step.

### LEDGER

**LOCKED**
- `LOOM-V1-V2-BOUNDARY-AUDIT-001` (P20, V1/V2 Boundary & Provider Bridge Sequencing)
- `LOOM-V1-V2-CODEBOUNDARY-MARKING-001` (P20, V1/V2 Boundary & Provider Bridge Sequencing)
- `CONTEXT-PIPELINE-AGENT-INTEGRATION-DESIGN-001` (P20, V1/V2 Boundary & Provider Bridge Sequencing)
- `PROVIDER-RUNTIME-SEAM-001` (P20, V1/V2 Boundary & Provider Bridge Sequencing)
- `CONTEXT-PIPELINE-FLOW-AUDIT-001` (P20, V1/V2 Boundary & Provider Bridge Sequencing) — this task

**ACTIVE**
- None

**NEXT**
- `CONTEXT-PIPELINE-AGENT-INTEGRATION-SPEC-001` (P20, V1/V2 Boundary & Provider Bridge Sequencing)
- `AGENTRUN-CONTEXT-CONSUMPTION-001` (P20, V1/V2 Boundary & Provider Bridge Sequencing)

**HOLD-BACKLOG**
- `MAIN-GENERATION-AGENTRUN-SHIM-001` (P20) — on hold pending `AGENTRUN-CONTEXT-CONSUMPTION-001`
- `PROVIDER-RUNTIME-BRIDGE-001` (P20) — on hold pending `ProviderRuntimeService` real-call extension
- `QUICK-ASK-AGENTRUN-SHIM-DESIGN-001` / `QUICK-ASK-AGENTRUN-SHIM-001` (P20) — on hold pending §9 sequence
- `TOOL-REGISTRY-EXECUTABILITY-001` (P11/P20) — on hold, not on critical path yet

### NEXT RECOMMENDED TASK

- `CONTEXT-PIPELINE-AGENT-INTEGRATION-SPEC-001` — amend the existing design doc to make the explicit context-source decision identified in §9 step 1; this is the smallest, lowest-risk action that unblocks everything else.
