# Loom PM Operating Model v1.0

## 0. Purpose

This document defines how `LOCKED` / `ACTIVE` / `NEXT` / `HOLD-BACKLOG` states are selected, and how PM skills (and any agent doing PM-tracking work) should read project state going forward. It is the operating model that `docs/loom_master_roadmap.md` is governed by. It does not replace `AGENTS.md` §17 (the Agent-PM directory/versioning protocol) — it specifies the *selection logic* for ledger states that §17 assumes exists but never defined precisely.

This is a design/planning document. It does not change any runtime code or existing PM files.

---

## 1. State Definitions

There are exactly four states a Phase, Epic, or Task can be in. A Task's state is derived bottom-up from its own checklist; a Phase/Epic's state is derived from the states of its children (see §2 aggregation rules).

| State | Meaning |
|---|---|
| `LOCKED` | All checklist items complete, validated (per `AGENTS.md` §8 validation gates), and the corresponding Task/Test/QA trio is fully checked. Closed — should not be reopened without a new Task ID. |
| `ACTIVE` | Currently being worked, or has at least one incomplete checklist item with no explicit hold. There is exactly one Phase that should be `ACTIVE` at a time at the *Phase* level (see §3); multiple Tasks within that Phase may be concurrently `ACTIVE`. |
| `NEXT` | Selected to be picked up after the current `ACTIVE` Phase/Task closes, with dependencies already satisfied. Ordered — `NEXT` is a queue, not a set. |
| `HOLD-BACKLOG` | Explicitly deprioritized. Dependencies may or may not be satisfied; the reason for not proceeding is a priority call, not a blocker. Distinct from "blocked," which is a dependency problem (see §1.1). |

### 1.1 `blocked` is not a fifth state

A Task or Phase can be `ACTIVE` or `NEXT` and simultaneously flagged `blocked_by: <ID>`. Being blocked is a property layered on top of the four states, not a replacement for them. A `NEXT` item that is blocked stays in the `NEXT` queue (so it's not forgotten) but cannot be promoted to `ACTIVE` until its blocker clears. This distinguishes "we haven't gotten to it" (`NEXT`, unblocked) from "we can't start it yet" (`NEXT`, blocked) from "we've chosen not to" (`HOLD-BACKLOG`).

---

## 2. Aggregation Rule (Task → Epic → Phase)

A Task's state comes directly from its checklist completion (see `AGENTS.md` §17: Task files use `- [ ]` / `- [x]` checklists).

An Epic's state is the rollup of its Tasks:
- All Tasks `LOCKED` → Epic is `LOCKED`.
- At least one Task `ACTIVE` (or partially checked) and none blocked from proceeding → Epic is `ACTIVE`.
- All Tasks `NEXT` (none started) → Epic is `NEXT`.
- Any Task explicitly marked `HOLD-BACKLOG` and no Task in the Epic is `ACTIVE` → Epic is `HOLD-BACKLOG`.

A Phase's state is the rollup of its Epics using the same rule, recursively. A Phase with mixed Epic states (e.g., some `LOCKED`, one `ACTIVE`) reports as `ACTIVE` — a Phase is `LOCKED` only when **every** Epic underneath it is `LOCKED`. This is why `docs/loom_master_roadmap.md` §2 shows phases like P02 (Provider Runtime) as `LOCKED` at 93% — at Phase-rollup granularity this is a simplification; the roadmap table's `Completion %` column is the precise number, and `LOCKED` there specifically means "no remaining work that gates downstream phases," which is documented per-phase in roadmap §3, not a strict 100%-children rule. PM skills computing state mechanically should use the strict rule (100% children = LOCKED) and treat any Phase the roadmap calls `LOCKED` at <100% as a deliberate human override — flag the discrepancy rather than silently "fixing" it.

---

## 3. How `ACTIVE` Is Selected

`ACTIVE` is selected from `NEXT` using this priority order, evaluated top-to-bottom — the first Phase/Task satisfying a tier wins:

1. **Unblocked items already in progress** (any checklist with both `[x]` and `[ ]` items) take priority over starting anything new. Finish what's open before opening more. (This is why P17 Memory Subsystem, at 81% with two partially-checked tasks, should be the `ACTIVE` Phase right now, not P18.)
2. **Items on the critical path** (per roadmap §4.4) outrank items on side branches. P17 → P18 → P20 is the critical path; P08/P09 packaging/STT work is explicitly a side branch and should not become `ACTIVE` ahead of critical-path work unless the critical path is fully blocked.
3. **Items with the fewest unresolved dependencies** outrank items with more. If two unblocked candidates tie on path priority, prefer the one that unblocks the most downstream work (e.g., resolving P11's drift unblocks P20's `TOOL-SCHEDULER-DESIGN-001` specifically, so if P20 work is imminent, P11 jumps the queue).
4. **Drift resolution outranks new feature work** when a drift case (per roadmap §5) directly contradicts the Task being considered for promotion. Do not promote a Task to `ACTIVE` if a known, unresolved drift case makes its actual status ambiguous (e.g., do not start new Tool Registry work until §5 case 4 is audited — you might be re-doing work that already exists, or building on a registry that doesn't exist).

Only **one Phase** should be `ACTIVE` at a time under this model. Multiple Tasks within that Phase may run concurrently if they don't share files/state, but cross-Phase parallelism should be the exception (e.g., a side-branch Phase like P09 STT-E2E can run in parallel with the critical-path `ACTIVE` Phase precisely because it's a side branch with no shared dependency).

---

## 4. How `NEXT` Is Selected

`NEXT` is an ordered queue, not a set. Selection rule: take every Phase/Task that is (a) not `LOCKED`, (b) not the current `ACTIVE` Phase, and (c) not `HOLD-BACKLOG`, and order them by:

1. Direct dependency on the current `ACTIVE` Phase closing (i.e., what becomes unblocked the moment `ACTIVE` finishes) — these go first.
2. Critical-path position (per roadmap §4.4) — critical-path items before side-branch items.
3. Age / staleness — among equal-priority candidates, prefer the one that has been waiting longest (avoid starving low-glamour work like P10's UI polish backlog indefinitely).

Concretely, today: `NEXT` = [P18 Agent Behavior design (unblocked the moment P17 closes), P11 drift audit (no hard blocker, but should happen before P20), P20 design docs (blocked on P17/P18), P08 packaging signing (side branch, unblocked), P09 STT E2E (side branch, unblocked)].

---

## 5. How `LOCKED` Is Selected

A Task is promoted to `LOCKED` when, and only when:

1. Every checklist item in its Task file is `[x]`.
2. Its paired Test file's expected inputs/outputs are satisfied (per `AGENTS.md` §17 Tests folder convention).
3. Its paired QA file's checklist is fully checked, with no regressions noted.
4. The validation commands appropriate to the change (per `AGENTS.md` §8/§8.1 — `./loom.sh --test` or `./loom.sh --publish --test` as applicable) have been run and reported, not merely assumed.

A Phase is promoted to `LOCKED` only when all its Epics are `LOCKED` by the same rule (§2). **Do not hand-promote a Phase to `LOCKED` because a ledger summary says so** — this is precisely the failure mode that caused the P17/P15/P14 drift documented in roadmap §5. The Task/Test/QA trio is the ground truth; the ledger (and now the roadmap) is a derived view.

---

## 6. How `HOLD-BACKLOG` Is Selected

An item moves to `HOLD-BACKLOG` when a human (not an agent) makes an explicit priority call that the work is correctly scoped and has no hard blocker, but should not be scheduled now. This is different from a low position in the `NEXT` queue — `NEXT` items are expected to be picked up eventually in order; `HOLD-BACKLOG` items require a deliberate decision to reactivate (move back to `NEXT`) before any agent should pick them up.

An agent or PM skill must never silently move an item out of `HOLD-BACKLOG` into `NEXT` or `ACTIVE` on its own initiative. The only legitimate path out of `HOLD-BACKLOG` is an explicit instruction in conversation ("un-hold X", "let's resume the Settings IA backlog") or a roadmap edit by a human.

Today's `HOLD-BACKLOG`: all of P19 (Settings IA, Privacy & Data backlog), pending the re-scope flagged in roadmap §3 P19 (several of its items may already be done under P08/P17 and need verification before reactivation, not blind resumption).

---

## 7. PM Skill Integration

This section defines the concrete read/write contract for any PM skill or agent performing roadmap-aware work.

### 7.1 Read roadmap
- Read `docs/loom_master_roadmap.md` §2 (Master Phase List) for canonical Phase IDs, status, and dependency edges.
- Never read Phase status from a filename prefix (`Phase4_...`) — filename prefixes are historical and may not match the canonical Phase ID. Use roadmap §2's mapping column.

### 7.2 Read ledger
- The ledger (`docs/loom_service_architecture_ledger.md`) is generated, not edited directly, going forward — see `docs/ledger_contract.md`. A PM skill reading "the ledger" should prefer the generated block (per the contract) over the old §13/§14/§19 hand-written sections, which are frozen historical record only.

### 7.3 Determine active phase
1. Read roadmap §2 for the Phase currently marked `ACTIVE`.
2. Cross-check against §3's selection rule (in-progress-first, critical-path-second) — if the marked `ACTIVE` Phase doesn't match what §3 would select, flag it as a discrepancy rather than silently treating either source as correct.
3. Report the active Phase's open Epics/Tasks (not just the Phase name) so the user can see exactly what's left.

### 7.4 Determine next task
1. Within the `ACTIVE` Phase, pick the first Task with at least one unchecked item and no unresolved `blocked_by`.
2. If the `ACTIVE` Phase has no such Task (i.e., it's actually done), recommend promoting it to `LOCKED` per §5 and pulling the head of the `NEXT` queue (§4) as the new `ACTIVE` Phase — but do not do this promotion automatically; surface it as a recommendation for the user to confirm, consistent with `AGENTS.md`'s "no silent ledger changes" rule.

### 7.5 Generate progress reports
A progress report must strictly adhere to the structural and data requirements defined in `docs/pm_reporting_contract.md`. This includes generating the mandatory `ROADMAP STATUS` block, executing progress calculations based on physical checklist items, computing the engineering estimation, and checking for roadmap drift.

### 7.6 Detect roadmap drift
A PM skill should flag drift whenever it observes any of the following, without trying to silently resolve them:
1. A Task/Test/QA file's checklist state disagrees with the ledger's LOCKED/ACTIVE/NEXT block for the same task ID (see roadmap §5 cases 1–3).
2. A Task referenced as a dependency by another Task's design doc cannot be found, or is found with a contradictory completion state (see roadmap §5 case 4 — Tool Registry).
3. Two Task files share an ID-like name but one uses the canonical prefixed form and one doesn't (see roadmap §5 case 5 — `Concurrency`/`Fingerprint` vs their ledger-tracked equivalents).
4. A Phase's roadmap-stated `Completion %` doesn't match a fresh recount of its children's checklists.

When any of these are detected, the skill must: (a) report the discrepancy explicitly, citing both sources, (b) **not** auto-correct either source, and (c) recommend which source is more likely authoritative based on recency (newer Task/QA file timestamps generally outrank older ledger prose, since the ledger has historically lagged — see roadmap §5's pattern). Resolution requires either a human decision or, where the drift is about actual runtime behavior (e.g., does the Tool Registry exist in code), a code audit — never a guess.

---

## 8. Changelog

- v1.0 (this document): Initial PM operating model created under ROADMAP-REBASE-001, defining state-selection logic for LOCKED/ACTIVE/NEXT/HOLD-BACKLOG and the PM-skill read/integration contract against `docs/loom_master_roadmap.md`.
