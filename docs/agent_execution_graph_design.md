# Agent Execution Graph Design v1.0

Status: DESIGN ONLY — no runtime, scheduler, adapter, or ProviderRuntime code modified.
Task: `AGENT-EXECUTION-GRAPH-DESIGN-001`

## 0. Grounding

Current production chain, confirmed directly from `agent_runtime/runtime.rs` and `tool_scheduler_runtime.rs` as of this design:

```
AgentRuntime::execute_run
  → ContextBuild step (legacy ContextManager, if legacy_context supplied)
  → ProviderCall step (ProviderRuntimeService lifecycle + real ProviderPipeline::stream_chat)
  → ToolCallPlaceholder step
      → ToolSchedulerRuntime::submit_invocation (real bridge, landed since the last audit)
      → tool_id = "runtime.agent.placeholder" (kind "adapter_contract")
      → no ToolAdapter implementation exists → ADAPTER_NOT_IMPLEMENTED_SAFE_CODE
  → ArtifactPlaceholder step (fake artifact_id, unconnected to the real tool_artifacts table)
  → ValidationPlaceholder step
  → RunCompleted
```

This is a single, strictly linear path: one context build, one provider call, one tool probe (always a placeholder, always not-implemented), done. There is no fan-out, no join, no loop, no conditional, no sub-agent. This document designs what replaces it without requiring a second rewrite when multi-agent/parallel-tool requirements land — the explicit failure mode this design must avoid is "build a graph engine, then redesign it again for multi-agent six months later," which is exactly the kind of repeated-rework pattern this codebase's V1→V2 migration history (`docs/loom_v1_v2_boundary_audit.md`, `docs/runtime_architecture_state_audit.md`) has already paid for once.

---

## 1. Canonical Execution Graph Architecture

**Decision: a Directed Acyclic Graph (DAG) of typed nodes, where each node's own execution is a small state machine — not a pure state machine over the whole run, not an execution tree, not a generic cyclic workflow graph.**

### Why DAG, not the alternatives

- **Pure state machine** (one big enum covering the whole run, as `AgentRunStatus` effectively is today): cannot express two things happening at once. The moment a Planner wants to fan out to 3 tools in parallel, a single state-machine model has no way to represent "currently in two states at once" without becoming a DAG in disguise. Reject.
- **Execution tree**: trees can express fan-out (a node's children) but cannot express fan-in/joins cleanly — a join node by definition has more than one parent, which is not a tree edge. Every real "wait for tool A and tool B, then aggregate" requirement breaks a tree model immediately. Reject.
- **Generic cyclic workflow graph** (arbitrary cycles, no acyclicity guarantee): more expressive than needed and removes the one safety property that makes a graph executor easy to reason about — guaranteed termination of the *graph structure* itself. Reject the generic form, but see "loop-back edges" below: the *provider loop* (Planner → Tools → Provider → Planner) is intentionally a bounded, explicitly-iteration-capped re-entry, not a structural cycle in the persisted graph. Each iteration is compiled as a fresh acyclic segment; "looping" is a runtime behavior (re-running a known node template with a bumped iteration counter), not a graph edge pointing backward. This preserves DAG guarantees for the persisted structure while still supporting iteration.
- **DAG of typed nodes, each with its own state machine**: this is the standard, proven shape for this class of problem (Temporal workflows, AWS Step Functions, Airflow DAGs, LangGraph's own model all converge here for the same reasons) — fan-out/fan-in, conditionals, retries, and partial failure all have well-understood DAG semantics, and per-node state machines (the existing `AgentStepStatus`-style `pending → running → waiting → completed/failed/cancelled/skipped` model already in `agent_runtime/types.rs`) require zero new lifecycle vocabulary, only a new structural container around them.

### Two layers, not one

1. **Graph Template** — the static shape: node definitions, edge definitions, join policies. Built once per "kind" of run (e.g., "standard conversational turn," "research-with-parallel-tools turn"), not once per execution. Templates are versioned, similar to how `docs/agent_runtime_contracts.md` §4 already versions `Agent`/`AgentRevision` definitions.
2. **Graph Instance** — one execution of a template for one `AgentRun`. This is where per-node state, timing, retry counts, and edge traversal history live. An instance references its template by ID; it does not duplicate the template's structure.

This split exists because it is the only way to make §14 (Persistence) and §15 (Migration) tractable: today's exact linear flow becomes Graph Template #1 ("linear-v1"), and every future template is additive, never a breaking redefinition of an existing one's node IDs.

---

## 2. Node Taxonomy

| Node Type | Mandatory for V1? | Purpose | Current code equivalent |
|---|---|---|---|
| `ContextBuild` | **Yes** | Resolve and assemble context for a turn | existing `AgentStepKind::ContextBuild` |
| `Provider` | **Yes** | One provider call/turn | existing `AgentStepKind::ProviderCall` |
| `Tool` | **Yes** | One tool invocation via the Tool Adapter Contract | existing `AgentStepKind::ToolCallPlaceholder`, generalized |
| `Join` | **Yes** | Synchronization point for fan-in (see §4) | none today — new |
| `Finish` | **Yes** | Terminal node; maps to `RunCompleted`/`RunFailed`/`RunCancelled` | implicit today (end of function) |
| `Planner` | Reserved, not built in V1 | Decides next action(s): which tools to fan out to, whether to loop, when to finish | none today — `DeterministicPlanner` (`orchestration/planner.rs`) is a *V1 orchestration* concept, unrelated; a graph `Planner` node is new |
| `Condition` | Reserved | Predicate-gated branch selection | none today — new |
| `Memory` | Reserved | Evaluates nominated `ToolAdapterMemoryCandidate`s; never writes directly (§8) | none today — new, deliberately thin |
| `Artifact` | Reserved | Promotes a node's output to a durable `ToolArtifactRecord` | the existing fake `ArtifactPlaceholder` step is retired in favor of this once real artifacts exist |
| `SubAgent` | Reserved | Delegates to a child `AgentRun`/nested graph instance (§9) | none today — new |
| `HumanApproval` | Reserved | Blocks pending an external approval signal | none today — new; not justified until a product surface needs it |
| `Summarizer` | Reserved | Compresses N upstream outputs into one summary before a `Provider`/`Join` | none today — new |
| `Evaluator` | Reserved | Scores/validates an upstream output (e.g. "did the tool result actually answer the question") | none today — new |
| `Retry` | **Not a node type** | Retry is an edge/policy attribute on the node it applies to (§3), not a separate node — making it a node would require every retryable node to have an awkward self-referencing edge for no benefit over a policy field |

**V1 mandatory set: `ContextBuild`, `Provider`, `Tool`, `Join`, `Finish`.** This is deliberately exactly what today's linear flow already uses plus `Join` (needed the moment more than one `Tool` node can run per turn, which is the first real capability this design unlocks). Everything else is reserved — defined here so a later task doesn't invent a second taxonomy, but not built until a concrete product need justifies it, per the same "don't build ahead of need" discipline `docs/quick_ask_agentrun_design.md` §5 already applied to Quick Ask.

---

## 3. Edge Taxonomy

| Edge Type | Semantics |
|---|---|
| `dependency` | Plain ordering: target node cannot start until source node reaches a terminal state. Default edge type. |
| `success` | Target only proceeds if source's terminal state was `Completed`. |
| `failure` | Target only proceeds if source's terminal state was `Failed` — this is how a fallback path is expressed (see §13: fallback is an edge semantic, not a node). |
| `cancelled` | Target only proceeds if source was `Cancelled` (rare; mainly used for cleanup-style nodes). |
| `timeout` | Target only proceeds if source's terminal state was specifically a timeout, distinct from a generic failure, so a "the tool was just slow" path can differ from "the tool errored." |
| `parallel` | Marks a set of edges leaving the same source as a fan-out group (§4) — a structural annotation, not a different runtime behavior from `dependency`. |
| `conditional` | Gated by a predicate evaluated against the source node's safe output/`safe_metadata`; only traversed if the predicate is true. Predicates are restricted to safe, structured fields — never raw content — consistent with the "identity/metadata only" discipline already enforced throughout the codebase (Context Selection candidates, Tool Adapter results, etc.). |
| `loop` | A *template-level* construct only: marks that a node template is iteration-capable (see §1's "bounded re-entry" note) — does not appear as a literal backward edge in a persisted instance graph, which stays acyclic. |
| `retry` | Not an edge between two different nodes — a self-attribute (`retry_policy` on the node definition: max attempts, backoff). Listed here because the task description asked for it explicitly; modeled as policy, not topology, for the same reason `Retry` isn't a node type. |

---

## 4. Parallelism

- **Fan-out**: a node (typically `Planner`, or `Tool` in the V1-minimal case where the orchestrator — not yet a `Planner` node — decides to invoke N tools at once) has multiple outgoing `parallel`-grouped edges, each to an independent `Tool`/`Provider`/etc. node. Each fanned-out branch executes independently and may itself contain further structure (it is not required to be a single node).
- **Fan-in / Join**: a `Join` node has multiple incoming edges and one `join_policy`:
  - `wait_all` (barrier) — proceeds only once every incoming branch reaches a terminal state; if any required branch terminates in `Failed` (not `Completed`), the join itself terminates `Failed` unless a `failure` edge from that specific branch was explicitly modeled as tolerated (see partial completion below).
  - `wait_any` (race) — proceeds as soon as the first branch reaches `Completed`; once that fires, the join's policy further decides whether to cancel the remaining branches (default: yes, cancel — a race that doesn't cancel its losers is just an expensive `wait_all` with a more confusing name) or let them run to completion silently for telemetry/audit purposes only (`cancel_losers: bool` flag on the join definition).
  - `first_success` — like `wait_any`, but explicitly only `Completed` (not `Failed`/`Cancelled`) branches count as a qualifying first result; if all branches fail before any succeeds, the join itself fails.
  - `quorum` (partial completion) — proceeds once a configured minimum count/fraction of branches reach `Completed`, tolerating the rest failing or still running (which then get cancelled once quorum is met, same `cancel_losers` semantic as `wait_any`).
- **Barrier** is not a distinct policy — it is the common name for `wait_all` and is documented as such to avoid a fourth synonym proliferating later.

---

## 5. Execution Context

- **One Context Snapshot per Graph Instance, not per node.** This directly extends the existing rule in `docs/agent_runtime_contracts.md` §10 rule 1 ("A run has at most one finalized Context Snapshot") — under this design, "run" there is read as "graph instance," and individual nodes (including parallel branches) reference that one snapshot by ID rather than each creating their own. A `ContextBuild` node is the only node type permitted to *create* a new snapshot; if a later iteration of a provider loop needs materially fresher context, that is a second `ContextBuild` node explicitly placed in the template for that iteration, not an implicit side effect of any other node.
- **What's shared vs. new**: all nodes within one Graph Instance share the same snapshot lineage (read access to the same identity-only candidate set). No node — including parallel `Tool` branches — gets a private copy of context; they get the same reference. This avoids the failure mode of two parallel tool calls silently diverging on what context they "saw."
- **Ephemeral outputs** (provider deltas, raw tool stdout-equivalent, anything `ToolAdapterContextDisposition::Discard`/`Ephemeral`) never leave the node that produced them and are never written to the Graph Instance's persisted state — consistent with §14.
- **Artifacts and memory** flow out of a node only through the routing described in §6/§7 — never directly between two nodes as raw data. A downstream node that needs an upstream node's output reads it through the same `(source_kind, source_id, chunk_ref)` identity-resolution discipline Context Selection already uses, not through an in-memory handoff of content. This keeps the graph's edges metadata-only (control flow), never content-carrying.

---

## 6. Artifact Routing

Every node may produce zero or more `ToolAdapterArtifact`-shaped outputs (reusing the contract from `TOOL-RUNTIME-ADAPTER-CONTRACT-001` directly — this design does not invent a second artifact shape). Routing is declared by the node's own `ToolAdapterContextContribution.disposition`, evaluated once the node reaches a terminal state:

- `Discard` → nothing persists; the output existed only transiently for whatever computed it.
- `Ephemeral` → visible to the rest of the *current* Graph Instance (other nodes can reference it by an in-instance identifier) but is not persisted past the run's lifetime — analogous to a provider delta, just structured.
- `Artifact` → promoted to a real `ToolArtifactRecord` via `ToolSchedulerRepository` (the same repository the Tool Adapter Contract already integrates with by design — see `tool_adapter_contract.rs`'s `ToolAdapterArtifactKind::to_scheduler_kind()`), with `root_run_id`/`agent_run_id` set to the Graph Instance's owning run.
- `Memory` → does not itself persist an artifact; it routes to §7 instead.

This routing decision is made by a node's *own adapter/implementation*, not by the graph engine — the graph engine's job is purely to read the disposition after the fact and call the right repository method. The graph engine itself never inspects content to make this decision.

---

## 7. Memory Routing

Three explicit stages, matching the task's required separation and consistent with the existing Memory subsystem's write-pipeline ownership (`storage/repositories/memory.rs`, Memory Policy Engine):

1. **Memory Candidate** — any node may emit `ToolAdapterMemoryCandidate`s (already defined in the Tool Adapter Contract: `safe_summary`, `topic_key`, `memory_type_hint`). This is a nomination, not a write. A node never calls a memory-write method directly — there is no such method reachable from a node's execution context at all, by construction (the same "no field to populate" discipline already used for prompts/payloads applies here to write-access, not just to data shape).
2. **Memory Evaluation** — a `Memory` node type (reserved, §2) or a cross-cutting evaluation pass collects candidates from a completed Graph Instance and applies the existing conflict-resolution/supersession rules (topic-key matching, explicit-over-implicit priority — per the Memory Subsystem work already completed). This stage decides accept/reject/merge, but still does not write.
3. **Memory Commit** — only the existing Memory write pipeline (already-shipped repository methods, already enforcing `user_confirmed`/`deleted_at`/forbidden-marker rules) performs the actual SQLite write, taking evaluated candidates as input. This stage is explicitly out of this design's scope to redesign — it already exists and this design routes into it, not around it.

---

## 8. Context Routing (Adapters)

File, Web, OCR, Shell, and future MCP adapters all inject context through exactly the same path: their `ToolAdapterResult.context_contribution` (a `ToolAdapterContextContribution`), routed by a `Tool` node exactly as described in §6/§5 — there is no adapter-type-specific context injection mechanism. This is a deliberate uniformity requirement: an OCR adapter's "this image's extracted text is useful for context" declaration and a Web adapter's "this search result is useful for context" declaration are structurally identical events to the graph engine, differing only in `safe_preview` content and `artifact_kind`. Per `docs/tool_runtime_implementation_state_audit.md` §1 (#12), this also reuses the `ToolMcpContext` reserved Context Selection tier (or a successor identity-only tier covering all tool-sourced context, not an MCP-specific one) as the eventual landing place once `TOOL-CONTEXT-INJECTION-DESIGN-001` (already recommended in that audit) is executed — this design does not implement that tier, only confirms the routing path feeding into it is adapter-agnostic.

---

## 9. Provider Loop

**Current model** (linear, confirmed in §0): one `ContextBuild` → one `Provider` → one `Tool` probe (always a no-op today) → done. No second provider turn exists.

**Target model**:

```
ContextBuild
  ↓
Planner            (decides: finish now, or fan out to tools)
  ↓ (parallel fan-out, 0..N branches)
Tool₁  Tool₂  ...  Toolₙ
  ↓ (join: wait_all by default, quorum/race available per template)
Join → Aggregator-as-Summarizer (optional, collapses N tool outputs into one
       safe summary before the next Provider call, instead of stuffing N raw
       results into context directly)
  ↓
Provider           (one turn, consumes aggregated tool outputs + context)
  ↓ (loop-back, bounded by max_iterations on the Planner node template)
Planner            (re-entry: decide again — finish, or fan out again)
  ↓ ... (repeat, capped)
  ↓
Finish
```

The loop-back from `Provider` to `Planner` is the bounded re-entry described in §1 — implemented as the graph *instance* re-running the `Planner`/fan-out/`Join`/`Provider` node template segment with an incremented iteration counter, not as a literal cyclic edge in the persisted graph. A hard `max_iterations` cap (template-level, not configurable per-request without an explicit override path) is mandatory to prevent runaway loops — this is the single most important safety property of this section and must not be left implicit in any implementation task that builds this.

**V1 minimal slice of this loop** (see §15 Migration): a single `Planner`-less version where the orchestrator fans out to a fixed, known set of tools once per `Provider` call (no re-entry yet) is sufficient to prove §4's join semantics work, before building the `Planner` node and loop-back behavior at all.

---

## 10. SubAgent Model

A `SubAgent` node delegates execution to a **child Graph Instance**, which is itself a full, independently-typed `AgentRun` — not a special execution mode bolted onto the parent's own graph. This directly follows the existing frozen contract in `docs/agent_runtime_contracts.md` §6, which this design does not redefine, only wires into the graph model:

- **Parent run / child run**: the `SubAgent` node's execution *is* `subagent.spawn_requested` → (child `run.created` → ... → child terminal) → `subagent.completed`/`failed`/`cancelled` observed by the parent, exactly per `docs/agent_runtime_event_model.md` §3.5's existing event flow. The graph model adds nothing new to this event sequence — it only says "a `SubAgent` node's internal state machine is driven by these events," giving the existing contract a place to plug into a graph.
- **Context inheritance**: per `docs/agent_runtime_contracts.md` §6 rule 6 and `docs/context_pipeline_agent_integration_design.md` §7, the child inherits the parent's resolved context by reference (the same Context Snapshot lineage, not a copy) unless its own template includes a `ContextBuild` node that explicitly creates a new one.
- **Artifact inheritance**: a child's artifacts are owned by the child's `agent_run_id`/`root_run_id` (consistent with `ToolArtifactRecord`'s existing schema, which already has both fields) but are visible to the parent through normal `root_run_id`-scoped queries — no copying, no separate inheritance mechanism needed because the schema already supports root-scoped visibility.
- **Memory visibility**: per `docs/quick_ask_agentrun_design.md`-style reasoning, a child can *see* memory the same way any node can (read access is not run-scoped, memory is global/loom-scoped per the existing schema), but a child's own memory *candidates* (§7) are still subject to the same Evaluation/Commit gate as anything else — a child cannot bypass memory governance just by being a child.
- **Cancellation**: parent subtree cancellation propagates to every non-terminal descendant, including detached ones — already specified in `docs/agent_runtime_contracts.md` §6 rule 5; this design adds that a `SubAgent` node's own state machine must observe this propagation as a `Cancelled` transition like any other node, so the graph engine's generic cancellation-propagation logic (§13) does not need a SubAgent-specific carve-out.

---

## 11. Execution Identities

| Identity | Scope | Relationship to existing types |
|---|---|---|
| `run_id` | One `AgentRun` (root or child) | Existing `AgentRunId` — unchanged. |
| `graph_instance_id` | One execution of a Graph Template for one `run_id` | New. 1:1 with `run_id` for the root graph; a `SubAgent` node's child has its own `graph_instance_id` tied to its own `run_id`. |
| `node_id` | One position in a Graph Template (static) | New. Stable across every instance of that template. |
| `node_execution_id` | One actual attempt at running a `node_id` within one `graph_instance_id` | New. A node executed twice (retry, or a loop-back re-entry of a template segment) has two `node_execution_id`s sharing one `node_id`. |
| `step_id` | — | Existing `AgentStepId` is superseded by `node_execution_id` going forward, but is not deleted by this design — see §15; today's five fixed steps remain a valid degenerate case (one `node_execution_id` per legacy step kind). |
| `edge_id` | One edge definition in a Graph Template (static) | New, mainly for observability (§12) — individual *traversals* of an edge are not separately identified; they're implied by the two nodes' `node_execution_id`s and timestamps. |
| `execution_id` | Ambiguous in the task prompt; this design resolves it as a synonym for `node_execution_id` | Avoids introducing a fourth near-duplicate identity. |
| `tool_invocation_id` | One Tool Scheduler invocation | Existing, from `storage/repositories/tool_scheduler.rs` — a `Tool` node's `node_execution_id` has at most one `tool_invocation_id`. |
| `provider_execution_id` | One Provider Runtime execution | Existing, from `provider_runtime.rs` (`{run_id}-provider-exec`-style, per `PROVIDER-RUNTIME-BRIDGE-001`) — a `Provider` node's `node_execution_id` has at most one. |
| `artifact_id` | One artifact | Existing, from `storage/repositories/tool_scheduler.rs`. |
| `memory_candidate_id` | One nominated memory candidate | New (the Tool Adapter Contract's `ToolAdapterMemoryCandidate` has no ID field today — this design recommends adding one when the Memory Evaluation stage, §7, is actually implemented, not before). |

---

## 12. Observability

Every `node_execution_id` exposes: `node_id` (which template position), `state` (its own state-machine status), `started_at`/`finished_at`/`duration_ms`, `retry_count`/`attempt`, `telemetry` (reusing `ToolAdapterTelemetry`'s shape for `Tool` nodes; an equivalent for `Provider`/other node kinds), `error` (if terminal-failed, using a node-kind-appropriate error model — `ToolAdapterError` for `Tool` nodes, `ProviderError`-derived safe codes for `Provider` nodes), `dependencies` (the `node_id`s of every incoming edge's source), and `children` (for `SubAgent`: the child `run_id`/`graph_instance_id`; for a fan-out source: the `node_id`s of the branches it spawned). This is a strict superset of what `AgentEvent`'s existing `step.*` events already expose — no existing observable field is removed, only given a richer structural home.

---

## 13. Failure Model

- **Node failure**: a single `node_execution_id` reaches `Failed`. Whether this is recoverable is determined by the node's own retry policy (§3) — if attempts remain, a new `node_execution_id` for the same `node_id` is created and the failed one stays in history, not overwritten (append-only, consistent with the existing durable-event-log discipline).
- **Graph failure**: propagation upward through edges/joins per §4's policies — a `wait_all` join fails if a required branch's *final* `node_execution_id` (after retries are exhausted) is `Failed`; a `wait_any`/`first_success`/`quorum` join tolerates some branch failures by definition.
- **Recoverable vs. fatal**: mirrors the Tool Adapter Contract's own `ToolAdapterErrorKind::default_retryable()` distinction (`Timeout`/`TemporaryFailure`/`AdapterUnavailable` default-retryable; `PermissionDenied`/`InvalidArguments`/`PermanentFailure`/`PrivacyRejection`/`ValidationFailure` default-fatal) — this design does not invent a second classification, it reuses the one already shipped.
- **Fallback**: expressed as a `failure`-typed edge (§3) from a node to an alternate node, taken only once that node's retries are exhausted and it reaches a final `Failed` state — not a node type, not a special graph-level mechanism.
- **Cancellation propagation**: a `Cancel` signal issued against a `graph_instance_id` (or any ancestor `run_id` per §10's SubAgent rule) marks every non-terminal `node_execution_id` in scope as `Cancelled`, using the same cooperative dual-path model (state transition first, then a best-effort signal to whatever is actually running — provider stream, tool adapter, child run) already proven by `AgentRunStore`/`ProviderRuntimeService`'s existing cancellation code.

---

## 14. Execution Graph Storage

**Persisted** (content-free, mirroring every existing durability rule in this codebase):
- Graph Template definitions (node/edge/join-policy structure) — versioned, append-only, analogous to `(agent_id, agent_revision)` immutability per `docs/agent_runtime_contracts.md` §4 rule 1.
- Graph Instance: `graph_instance_id`, `run_id`, `template_id`+version, overall state.
- Per-`node_execution_id` rows: `node_id`, state, timestamps, retry_count/attempt, references to `tool_invocation_id`/`provider_execution_id`/`artifact_id` where applicable, and safe error codes — exactly the shape `AgentStep`/`ToolInvocationRecord`/`ProviderExecutionRecord` already persist today, generalized to a graph position instead of a fixed step kind.
- Edge traversal facts needed for replay/audit (which edge was taken out of a `Condition` node, which branches a `Join` actually waited on/cancelled) — safe, structural, no content.

**Ephemeral, never persisted** (unchanged from every existing rule in this codebase): provider deltas, raw tool stdout/stderr-equivalent output, prompts, provider request/response payloads, raw thinking, secrets/credentials. A node's *content* output is never itself a persisted field anywhere in this model — only its routed artifact/memory-candidate/context-contribution metadata (§§6-8) and its lifecycle/telemetry (§12) persist.

This design introduces no new privacy surface: every new persisted field is metadata (IDs, enums, timestamps, counts), and every content-shaped field continues to flow only through the already-audited Tool Adapter Contract and Provider Runtime seams, both of which already enforce forbidden-marker validation at construction time.

---

## 15. Migration Strategy

This is a phased introduction, not a rewrite-in-place — today's exact behavior must be expressible as the simplest possible instance of the new model before anything more complex is attempted.

**Phase 0 (this document)**: design only, no code.

**Phase 1 — Types only.** Define `GraphTemplate`/`GraphInstance`/`Node`/`Edge`/the node-kind enum and join-policy enum in Rust, with zero execution semantics wired to anything. Pure data modeling, fully unit-testable in isolation (construct templates, serialize, assert shape) without touching `AgentRuntime`.

**Phase 2 — Trivial compiler + equivalence proof.** Write a function that expresses *today's exact linear flow* (`ContextBuild → Provider → Tool → Finish`, dropping the fake `ArtifactPlaceholder`/`ValidationPlaceholder` steps per `docs/tool_runtime_implementation_state_audit.md` §4's deletion candidates) as a `GraphTemplate` with no parallelism. Do not yet change `execute_run`'s actual implementation — this phase only proves the new types can *describe* current behavior.

**Phase 3 — Graph-driven executor for the trivial template.** Replace `execute_run`'s hand-written sequential step code with a generic graph-traversal executor that happens to be given only the trivial single-path template from Phase 2. This is the riskiest phase from a regression standpoint and must be behavior-identical to today (same event sequence, same terminal semantics) — gate it behind the existing test suite (`test_agent_runtime_lifecycle_event_order` and siblings) passing unmodified, plus new graph-specific tests.

**Phase 4 — Parallel `Tool` fan-out + `Join`.** Only after Phase 3 is stable: allow a template to fan out to N `Tool` nodes feeding one `Join`. No `Planner` node yet — the set of tools to call is still decided by the same fixed logic as today (or a simple explicit list), just no longer limited to exactly one tool.

**Phase 5 — Provider loop (`Planner` + bounded re-entry).** Add the `Planner` node type and the capped loop-back described in §9. This is the first phase that changes the *number* of provider calls a single `AgentRun` can make — needs its own dedicated risk review (max-iteration enforcement, cost/latency implications) before shipping.

**Phase 6 — `SubAgent` node + nested graph delegation.** Wires §10 into the executor. Depends on Phases 1-3 being stable since a child run is itself a full graph instance.

**Phase 7 — Memory routing pipeline (`Memory` node / evaluation pass).** Wires §7 into real Memory subsystem write calls. Can proceed in parallel with Phase 6 since it doesn't depend on SubAgent.

**Phase 8+ — `Condition`, `HumanApproval`, `Summarizer`, `Evaluator` nodes**, each only when a concrete product surface needs it, per the reserved-not-built principle in §2.

---

## 16. Recommended Implementation Order

1. `AGENT-EXECUTION-GRAPH-TYPES-001` — Phase 1 types, no execution.
2. `AGENT-EXECUTION-GRAPH-TRIVIAL-TEMPLATE-001` — Phase 2 equivalence proof (data only, no `execute_run` changes).
3. `AGENT-EXECUTION-GRAPH-EXECUTOR-001` — Phase 3 graph-driven executor for the trivial template; must not regress any existing `agent_runtime/runtime.rs` test.
4. `ARTIFACT-PLACEHOLDER-RETIREMENT-001` — already recommended in `docs/tool_runtime_implementation_state_audit.md` §5 task 10; do this alongside #3 since the trivial template already drops the fake placeholder steps.
5. `AGENT-EXECUTION-GRAPH-PARALLEL-TOOLS-001` — Phase 4 fan-out + `Join`.
6. `AGENT-EXECUTION-GRAPH-PERSISTENCE-001` — durable Graph Instance storage (§14), needed before Phase 5's loop makes per-iteration history worth persisting richly.
7. `AGENT-EXECUTION-GRAPH-PROVIDER-LOOP-001` — Phase 5 `Planner` + bounded re-entry, with an explicit, separately-reviewed max-iteration/cost safety design before implementation.
8. `AGENT-EXECUTION-GRAPH-SUBAGENT-001` — Phase 6, depends on `agent_runtime_contracts.md` §6 remaining the frozen reference (re-review it first, per the recommendation already made in `docs/runtime_architecture_state_audit.md` §5 task 9).
9. `AGENT-EXECUTION-GRAPH-MEMORY-ROUTING-001` — Phase 7, depends on the Tool Adapter Contract's `ToolAdapterMemoryCandidate` gaining a stable ID (§11) and at least one real adapter (from `docs/tool_runtime_implementation_state_audit.md`'s own recommended order) actually producing candidates worth evaluating.
10. `AGENT-EXECUTION-GRAPH-CONDITIONAL-NODES-001` — Phase 8's `Condition` node, first of the reserved set to build, only once a concrete branching use case exists.

This order assumes (and depends on) `docs/tool_runtime_implementation_state_audit.md`'s own recommended order proceeding on its own track — the first real `Tool` node content (an actual File or Web adapter) is not gated by this document's phases, and this document's phases are not gated by adapters existing either; they can proceed in parallel, since the graph engine work is about *structure* and the adapter work is about *content*.

---

## 17. Risk Analysis

1. **Complexity creep.** A graph engine is more powerful, and therefore easier to over-build, than the linear chain it replaces. Mitigation: the reserved-not-built node taxonomy (§2) and the strict phase gating (§15) are both deliberate forcing functions against building `HumanApproval`/`Evaluator`/etc. before anything needs them.
2. **Persistence volume growth.** A graph instance with parallel branches and loop iterations persists materially more rows than today's fixed 5-step sequence. Mitigation: flagged explicitly so Phase 6 (Persistence) includes a retention/pagination review, the same flag already raised for Tool Scheduler volume in `docs/runtime_architecture_state_audit.md` §8 risk 4.
3. **Cancellation propagation across parallel branches.** Cancelling a `wait_all` join's losing branches (or a `SubAgent`'s descendants) correctly, without leaving an orphaned `node_execution_id` in a non-terminal state forever, is genuinely subtle. Mitigation: Phase 3's executor must get single-path cancellation exactly right first (reusing the existing dual-path cancellation pattern) before Phase 4 adds the first opportunity for *multiple* branches to need simultaneous cancellation.
4. **Unbounded provider loops.** The single highest-severity risk in this entire design (§9) — a missing or misconfigured `max_iterations` cap turns a bounded design into an unbounded cost/latency liability. Mitigation: called out as mandatory, not optional, and Phase 5 is explicitly gated on its own dedicated safety review rather than bundled into general "add the loop" work.
5. **Context Snapshot sharing across parallel branches** violating the existing "one snapshot per run" contract rule if not carefully redefined as "per graph instance." Mitigation: §5 explicitly redefines the rule's scope rather than leaving it ambiguous, and this redefinition should be the first thing `AGENT-EXECUTION-GRAPH-TYPES-001`'s implementer confirms against `docs/agent_runtime_contracts.md` §10 before writing any types, in case that contract document itself needs a formal amendment rather than just a reinterpretation.
6. **Two-identity confusion (`node_id` vs. `node_execution_id`)** — easy to conflate during implementation, given `AgentStepId` today conflates "which step" and "which attempt" into one identity. Mitigation: §11's table is written specifically to be copy-pasted into the first implementation task's design review as an explicit checklist.

---

## 18. Files Created

- `docs/agent_execution_graph_design.md` (this document).
