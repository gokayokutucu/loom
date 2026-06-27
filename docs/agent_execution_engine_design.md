# Agent Execution Engine Design v1.0

Status: DESIGN ONLY — no Rust implementation, schema, or runtime changes.
Task: `AGENT-EXECUTION-ENGINE-DESIGN-001`

## 0. Relationship to `docs/agent_execution_graph_design.md`

That document defined the **shape** of execution (DAG of typed nodes, edge semantics, node taxonomy, provider loop, SubAgent model). This document defines the **engine** that actually runs a graph instance over time: how node readiness is computed and claimed, how state survives a crash, and — the single most load-bearing rule in this document — exactly when the engine is and is not allowed to let an LLM reason again without a human in the loop. Node/edge/join vocabulary here is inherited from that document, not redefined.

---

## 1. Execution Graph (Engine-Level Precision)

The graph design document specified node *kinds* and edge *semantics*. The engine adds one further distinction the graph document left implicit: a node's lifecycle has a state that exists **before** "running" and is **not** the same as "the node hasn't started because its dependencies aren't met yet." This distinction is the entire reason a scheduler is needed instead of a simple recursive walk of the graph.

### 1.1 Node Instance Lifecycle (State Machine #1)

```
Pending ──(all required incoming edges satisfied)──> Ready
Ready ──(worker acquires lease)──> Leased
Leased ──(worker begins execution)──> Running
Leased ──(lease expires before execution begins)──> Ready          [reclaimed]
Running ──(execution finishes successfully)──> Completed
Running ──(execution finishes with error, retries remain)──> Ready  [new attempt]
Running ──(execution finishes with error, retries exhausted)──> Failed
Running ──(cancellation signal observed)──> Cancelled
Running ──(this is a Provider node at a continuation boundary)──> WaitingForUserContinuation   [see §5]
WaitingForUserContinuation ──(explicit user action)──> Ready | Cancelled   [see §5]
```

`Completed`, `Failed`, `Cancelled` are terminal for a given **attempt**, but only `Completed`/`Cancelled` (and `Failed` once retries are exhausted) are terminal for the **Node Instance** as a whole — see §1.2 for the attempt-level distinction this implies.

`WaitingForUserContinuation` is reachable only from a `Provider` node (by the rule in §5) and is the one state in this machine that is not driven by any worker, lease, or timeout — only by an external user action. It must survive process restarts unchanged (§6).

### 1.2 Node Attempt Lifecycle (State Machine #2, nested inside Node Instance)

A `NodeInstance` can be attempted more than once (retry policy, or a crash-recovery re-attempt per §6). Each attempt is its own record:

```
Created ──(lease acquired)──> Leased
Leased ──(execution starts)──> Running
Leased ──(lease expires, never started)──> Abandoned   [terminal for this attempt only]
Running ──(heartbeat continues)──> Running             [self-loop, see §2.3]
Running ──(success)──> Completed
Running ──(error)──> Failed
Running ──(cancel signal)──> Cancelled
Running ──(lease expires mid-execution, no heartbeat)──> Abandoned
```

`Abandoned` is distinct from `Failed`: it means the engine lost contact with the attempt, not that the attempt itself reported failure. This distinction is what makes idempotent recovery (§2.5, §6) possible — an `Abandoned` attempt's real-world outcome is *unknown* until the engine checks the downstream subsystem (Tool Scheduler, Provider Runtime) for a terminal record under that attempt's identity.

### 1.3 Edge Semantics, Joins, Fan-out, Retries, Cancellation

Unchanged from `docs/agent_execution_graph_design.md` §3/§4/§13 — this document does not redefine them, only specifies how the scheduler (§2) evaluates them against persisted state rather than in-memory graph traversal.

---

## 2. Scheduler

### 2.1 SQLite is canonical; the in-memory ready queue is a cache, never a source of truth

Every `NodeInstance`/`NodeAttempt`/`Lease` state transition is a SQLite write **first**. The in-memory ready queue (a `tokio`-friendly work queue of `node_instance_id`s believed `Ready`) exists purely so workers don't have to scan the database on every tick. The defining property this design requires: **the in-memory queue must be fully reconstructable from SQLite at any moment, with zero information loss**, because that is exactly what happens on every service restart (§6). If a future implementation ever finds itself storing engine-relevant state only in memory, that is a design violation of this document, not an acceptable optimization.

### 2.2 Leases

A worker claims a `Ready` node by attempting an atomic, conditional SQLite update of the form "set `leased_by = <worker_id>`, `lease_expires_at = now + lease_duration` **where** `status = 'ready'` (or `leased` with an already-expired `lease_expires_at`)." Exactly one concurrent claimant can win this race per row, by ordinary SQLite single-writer semantics — no separate distributed-lock mechanism is needed. The losing claimant(s) simply observe zero rows affected and move on to the next ready item.

### 2.3 Heartbeat

While a `NodeAttempt` is `Running`, its owning worker periodically re-extends `lease_expires_at` ("heartbeat"). A worker that crashes, hangs, or is killed simply stops heartbeating; nothing it was holding needs to be explicitly notified — the lease's natural expiry is the only signal anything else needs. This is deliberately the same pattern `AgentRunStore`'s existing cancellation-signal mechanism already uses in spirit (cooperative, no requirement that the other side acknowledge anything) extended to liveness rather than cancellation.

### 2.4 Restart recovery (scheduler's role; full recovery taxonomy in §6)

On boot, before accepting any new work, the engine performs one pass: every `NodeAttempt` still recorded as `Leased`/`Running` from before this process existed is, by definition, holding a lease no living worker remembers. The engine does not need to wait for these leases to "expire" in the normal sense — process restart itself is treated as an immediate invalidation of every lease that process previously issued, because there is no way for a new process to know whether the old lease's `lease_expires_at` was trustworthy at all (clock skew, the old process having frozen rather than crashed cleanly, etc.). Every such attempt transitions to `Abandoned` and enters the idempotency check (§2.5) before anything is re-scheduled.

### 2.5 Idempotency

The engine does not invent a new idempotency mechanism — it composes the ones the downstream subsystems already enforce. Before re-attempting a `NodeInstance` whose previous attempt is `Abandoned`:

1. If the node delegates to the Tool Scheduler, query `ToolSchedulerRepository` for an existing invocation keyed by that attempt's `tool_invocation_id`. If a terminal record already exists (the tool actually finished before the crash, the engine just never heard about it), adopt that record as the attempt's real outcome instead of re-running anything.
2. If the node delegates to Provider Runtime, perform the equivalent check against `ProviderExecutionRecord`.
3. Only if neither check finds a terminal record does the engine create a genuinely new attempt and re-execute.

This "check before you redo" rule is the engine's entire idempotency contract — it does not require every future adapter to implement its own idempotency key scheme from scratch, only to be queryable by the identity the engine already hands it (`node_attempt_id`/`tool_invocation_id`/`provider_execution_id`, all of which the Tool Adapter Contract and Provider Runtime Bridge already carry).

### 2.6 Worker scheduling and bounded concurrency

A small pool of async workers pulls from the in-memory ready queue. Two concurrency limits apply before a lease is granted: a global maximum (protecting the whole service, analogous to the existing Ollama/provider concurrency policy already shipped under `PROVIDER-RUNTIME-CONCURRENCY-POLICY-001`) and an optional per-`GraphInstance` maximum (preventing one run's wide fan-out from starving every other run). Both are simple counters checked at claim time, not a separate subsystem.

### 2.7 Dependency resolution and join evaluation

Each time a `NodeAttempt` reaches a terminal outcome, the scheduler re-evaluates exactly the node's direct successors (not the whole graph) — for each successor, it checks whether every incoming edge whose condition matters (`dependency`/`success`/`failure`/`timeout`/`conditional`) is now satisfied, and if so transitions that successor `Pending → Ready`. A `Join` node's readiness is evaluated the same way except its condition is the join policy (`wait_all`/`wait_any`/`first_success`/`quorum`) applied across all of its incoming branches' current states, computed by querying sibling `NodeInstance` rows rather than maintaining a separate in-memory or table-based counter — this keeps join evaluation correct for free across restarts (§6), since it never depends on anything that doesn't already live durably in SQLite.

---

## 3. Parallel Execution

Independent branches are simply multiple `NodeInstance`s simultaneously `Ready`/`Leased`/`Running` under one `GraphInstance` — nothing about parallel execution requires a different code path from sequential execution at the scheduler level; sequential execution is just the degenerate case where dependency edges happen to serialize everything. The mechanics already specified in §2 (leases prevent double-claim, bounded concurrency caps total parallelism, join evaluation aggregates sibling state via SQLite queries) are sufficient on their own — this section exists only to confirm explicitly, per the task's requirement, that no additional parallel-specific machinery is needed beyond what §2 already defines.

---

## 4. Persistence

### 4.1 Persistent Objects

| Object | Cardinality | Purpose |
|---|---|---|
| `GraphTemplate` | one per template version | Static node/edge/join-policy definitions (from `docs/agent_execution_graph_design.md` §1) |
| `GraphInstance` | one per executed `AgentRun` graph | `graph_instance_id`, `run_id`, `template_id`+version, overall status, created_at/completed_at |
| `NodeInstance` | one per `node_id` within a `GraphInstance` | Current lifecycle state (§1.1), current attempt count, references to its `GraphInstance` |
| `NodeAttempt` | one per actual execution attempt of a `NodeInstance` | Attempt lifecycle state (§1.2), started_at/finished_at, outcome, safe error code, references to whatever downstream identity it produced (`tool_invocation_id`/`provider_execution_id`/etc.) |
| `Lease` | one active row per currently-leased `NodeAttempt` (rows may be retained historically or pruned — an implementation decision, not specified here) | `worker_id`, `leased_at`, `lease_expires_at`, last heartbeat timestamp |
| `ExecutionEvent` | append-only, many per `GraphInstance` | Durable, content-free audit log (`node.ready`, `node.leased`, `node.started`, `node.completed`, `node.failed`, `node.cancelled`, `join.satisfied`, `run.waiting_for_continuation`, `run.resumed`, `run.retried`, `run.cancelled`) — same forbidden-marker/no-content discipline as every existing `AgentEvent`/`ProviderRuntimeEvent` |
| `ContinuationCheckpoint` | one per `WaitingForUserContinuation` entry | Snapshot of which sibling branches/results were available at the moment reasoning paused — needed so "Continue with latest tool results" (§5) behaves correctly even after a restart, without re-deriving "what was available at the time" from a live-only state that may have moved on |

### 4.2 What is explicitly NOT persisted

Unchanged from every existing rule in this codebase: no prompt text, no provider request/response payload, no raw thinking, no raw tool stdout/stderr-equivalent output, no secrets/credentials. Every object in §4.1 is composed entirely of identifiers, enum states, timestamps, counts, and safe metadata — consistent with `docs/agent_execution_graph_design.md` §14's persistence rule, which this document inherits rather than re-derives.

---

## 5. User Continuation Policy

**This is the single most important rule in this document and the one future implementation work must never silently work around.**

### 5.1 The rule, stated precisely

A continuation boundary occurs at the completion of **every** `Provider` node, without exception. The engine MUST NOT automatically schedule any successor node that would itself lead to further LLM reasoning (another `Planner` node, another `Provider` node, or a loop-back re-entry per the bounded provider loop in `docs/agent_execution_graph_design.md` §9). On reaching this boundary, the engine transitions the relevant scope (see §5.2) to `WaitingForUserContinuation` and stops. The only way out of this state is one of the four explicit user actions in §5.3.

This is categorical, not heuristic. The design deliberately does not attempt to classify "this particular continuation is obviously safe to auto-resume" — any such classifier would itself become the thing that quietly breaks the guarantee under pressure to "make it feel more responsive" later. The rule has no exceptions clause.

### 5.2 What is exempt, and why that's not actually an exception

- **Tool execution already in flight continues running in the background.** A `Tool` `NodeAttempt` that was `Running` at the moment its sibling `Provider` node completed is not interrupted by entering `WaitingForUserContinuation` — it keeps running to its own natural terminal state, and its result is persisted (artifact/memory-candidate routing per the graph design's §6/§7) exactly as it would be otherwise. This is not an exception to the rule because a running `Tool` node was never going to cause *new LLM reasoning* on its own — only feeding its result into a subsequent `Provider`/`Planner` node would, and that is exactly the part this policy blocks.
- **Long-running jobs and indexing continue unaffected.** Retrieval projection rebuilds, attachment parsing, and similar background maintenance work are not part of any `AgentRun` graph at all — they are outside this document's scope entirely, not a carve-out within it.

### 5.3 Resume actions and their state transitions

| Action | Effect |
|---|---|
| **Continue** | The blocked successor edge out of the paused `Provider` node is unblocked; the next `Planner`/`Provider` node transitions `Pending → Ready` using exactly the `ContinuationCheckpoint` recorded when the wait began. |
| **Continue with latest tool results** | Same as Continue, except any sibling `Tool` branches that were still `Running` at decision time are explicitly marked detached from the now-resuming reasoning path — they keep running to completion for artifact/memory purposes (§5.2) but their eventual output is routed only as a future-available artifact/memory candidate, not awaited by the join that's about to resume. |
| **Retry** | A new `NodeAttempt` is created for the same `Provider` `NodeInstance` that just completed (not its successor) — used when the user wants a different answer to the same turn rather than proceeding. |
| **Cancel** | The `GraphInstance` (or the relevant subtree, if this boundary belongs to a `SubAgent`'s child instance) transitions to cancellation per `docs/agent_execution_graph_design.md` §13's propagation rules — including cooperative cancellation of any still-running background `Tool` branches if the user's cancel is meant to stop everything, vs. a narrower "stop reasoning but let in-flight tools finish" variant if the product surface wants to offer that distinction (left as a UI/product decision, not an engine constraint — the engine supports both shapes). |

### 5.4 Run-Level Continuation State Machine (State Machine #3)

This sits above the per-node lifecycle (§1.1) as a gate specifically over *reasoning* progression:

```
Active ──(Provider node reaches continuation boundary)──> WaitingForUserContinuation
WaitingForUserContinuation ──(Continue | Continue with latest tool results)──> Active
WaitingForUserContinuation ──(Retry)──> Active   [loops back to the same Provider node, not forward]
WaitingForUserContinuation ──(Cancel)──> Cancelled
```

`WaitingForUserContinuation` must be durable (§4.1 `ContinuationCheckpoint`) precisely because a user may not act for an arbitrary length of time — including across a full service restart, which must restore this exact state with zero automatic continuation (§6.7).

### 5.5 Why this is not merely a UX preference

The existing codebase already treats raw model reasoning as something that must never silently leak into persistence, retrieval, or context (`AGENTS.md` §15; enforced structurally throughout `provider_runtime.rs`, `tool_adapter_contract.rs`, Context Selection). This policy is the same philosophy applied to *timing* rather than *content*: the user remains the sole authority over whether another round of reasoning happens at all, not just over what that reasoning is allowed to contain. It is also, in effect, a strictly stronger version of the `max_iterations` safety cap `docs/agent_execution_graph_design.md` §9/§17 already flagged as the highest-severity risk in the provider loop — rather than trusting an engine-enforced numeric ceiling to prevent runaway reasoning loops and cost, this policy makes a human the ceiling, every single time, with no configurable bypass.

---

## 6. Shutdown Recovery

| Scenario | What the engine finds on next boot/tick | Recovery procedure |
|---|---|---|
| **App crash** | `NodeAttempt`s recorded `Leased`/`Running` with no corresponding live process | Transition every such attempt to `Abandoned`; run the idempotency check (§2.5) against the downstream subsystem before deciding to re-attempt or adopt the already-completed real outcome |
| **OS restart** | Identical to app crash from the engine's point of view | Identical recovery path — the engine cannot and should not try to distinguish "OS rebooted" from "process disappeared" structurally; both are simply "no living worker remembers this lease" |
| **Killed process (SIGKILL)** | Identical to app crash — no graceful shutdown signal will have fired | Identical recovery path — this scenario is the reason the design must never rely on a clean-shutdown hook as the *only* recovery mechanism |
| **Expired lease (worker hung/dead, process otherwise alive)** | A single `NodeAttempt`'s `lease_expires_at` has passed with no recent heartbeat, while the rest of the engine keeps running normally | Handled by the scheduler's ordinary tick (§2.2/§2.3), not a boot-time pass — the node is reclaimed and goes through the same idempotency check as any other `Abandoned` attempt, just without requiring a restart |
| **Partially completed fan-out (e.g. 2 of 3 parallel branches finished before a crash)** | 2 `NodeInstance`s terminal and untouched; 1 `Abandoned` | The 2 completed branches' records are authoritative and are never re-touched; only the incomplete one goes through recovery; the `Join` re-evaluates readiness exactly as it would during normal operation, since join readiness is always computed from sibling state (§2.7), not from a separately-tracked arrival counter that could itself be lost |
| **Graceful shutdown (clean signal honored)** | Active leases voluntarily released rather than left to expire | Recommend reusing the same `ready`/`draining`/`stopping` lifecycle already proven for the Electron-owned sidecar (`SERVICE-ELECTRON-GRACEFUL-DRAIN-001`), applied to the execution engine specifically — on a clean shutdown, mark in-flight leases as voluntarily released so the next boot's recovery scan has nothing to reconcile, purely as a faster/quieter path, not a required one (the crash path above must work correctly even if this never fires) |
| **Restart while a run is `WaitingForUserContinuation`** | The `GraphInstance`'s continuation state and its `ContinuationCheckpoint` are intact in SQLite, untouched by the crash (nothing was running that needed recovering — this state has no active lease by definition) | No recovery action needed beyond normal boot — the state is simply read back as-is; reaffirm explicitly that no automatic continuation may occur just because the service restarted, exactly as none may occur during ordinary operation (§5.1) |
| **Worker-local failure (process alive, one worker task panics) without a full crash** | One `NodeAttempt`'s lease silently stops heartbeating while the rest of the engine is unaffected | Same as "expired lease" above — this is the same mechanism, just triggered by an in-process partial failure rather than an external one; no special-case code path is needed because the lease-expiry mechanism doesn't care *why* heartbeating stopped |

---

## 7. Future Compatibility

| Future capability | Why no engine change is required |
|---|---|
| File / Web / OCR / Shell adapters | Each is just a `Tool` `NodeInstance` delegating to a concrete `ToolAdapter` implementation (`tool_adapter_contract.rs`). The engine's leasing/heartbeat/idempotency/persistence machinery is identical regardless of which adapter a `Tool` node happens to call — the engine does not know or need to know which adapter kind it is. |
| MCP | Same as above — per `docs/tool_runtime_implementation_state_audit.md`'s own finding, MCP is "one kind of tool adapter, not a parallel system," and this engine design treats it identically to File/Web/Shell for exactly that reason. |
| Memory | Routed entirely through the Candidate → Evaluation → Commit pipeline already specified in `docs/agent_execution_graph_design.md` §7; the engine's only involvement is persisting a node's nominated candidates as part of that `NodeAttempt`'s safe output metadata — no engine-level memory awareness is needed. |
| Subagents | A `SubAgent` `NodeInstance`'s "execution" is delegating to a fully independent child `GraphInstance` with its own `run_id`. Because `GraphInstance`/`NodeInstance`/`NodeAttempt`/`Lease` are already generic over "which run owns this," the engine recurses into itself with no special-casing — a child graph is scheduled, leased, heartbeated, and recovered by the exact same mechanisms as a root graph. |
| Human approval nodes | Fits the engine's existing vocabulary directly: a `HumanApproval` node's `Ready → Running` transition simply blocks pending an external signal, exactly like `WaitingForUserContinuation` already does at the run level — except scoped to a single node rather than gating an entire reasoning subtree. The same lease/heartbeat/persistence machinery applies; the only difference is that the "worker" completing the node is a person via a UI action rather than an async task, which the engine already does not need to distinguish (§2.6 doesn't care what kind of actor holds a lease). |

No row, column, state, or mechanism specified in §§1-6 needs to change shape to accommodate any item in this table — this is the explicit test this design was held to throughout, not an afterthought added at the end.

---

## 8. Summary: Every State Machine and Every Persistent Object

**State machines** (all defined above; restated here as the explicit inventory the task requested):
1. Node Instance Lifecycle (§1.1) — `Pending → Ready → Leased → Running → {Completed | Failed | Cancelled | WaitingForUserContinuation}`, with reclaim loops back to `Ready`.
2. Node Attempt Lifecycle (§1.2) — nested inside #1, tracks one execution attempt: `Created → Leased → Running → {Completed | Failed | Cancelled | Abandoned}`.
3. Run-Level Continuation State (§5.4) — `Active ↔ WaitingForUserContinuation → Cancelled`, the mandatory human gate over reasoning progression.
4. Lease state (implicit across §2.2/§2.3/§6) — `Active → (heartbeat-renewed)* → {Released | Expired}`.
5. Join readiness state (§2.7) — `Awaiting → {Satisfied | Failed}`, computed from sibling Node Instance states rather than tracked independently.

**Persistent objects** (§4.1, restated): `GraphTemplate`, `GraphInstance`, `NodeInstance`, `NodeAttempt`, `Lease`, `ExecutionEvent`, `ContinuationCheckpoint`.

**Recovery scenarios** (§6, restated): app crash, OS restart, killed process, expired lease, partially completed fan-out, graceful shutdown, restart during `WaitingForUserContinuation`, worker-local failure without full crash.

## 9. Files Created

- `docs/agent_execution_engine_design.md` (this document).
