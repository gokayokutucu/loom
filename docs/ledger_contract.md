# Loom Ledger Contract v1.0

## 0. Purpose

This document defines the canonical format for the **generated** ledger — the LOCKED / ACTIVE / NEXT / HOLD-BACKLOG block that, going forward, must be *derived* from `docs/loom_master_roadmap.md` and the live state of `_PM/Agent-PM/Tasks/`, `Tests/`, and `QA/`, rather than hand-maintained as prose (as `docs/loom_service_architecture_ledger.md` §14 currently is).

This is a design/planning document. It defines the contract; it does not implement a generator. No existing ledger file is modified by this document.

---

## 1. Why the Old Ledger Format Broke

`docs/loom_service_architecture_ledger.md` §14 is roughly 170 lines of hand-written prose, one bullet per completed task ID, manually appended over time, with a separate `ACTIVE`/`NEXT`/`HOLD-BACKLOG` block at the bottom. Two failure modes emerged, both documented as drift cases in `docs/loom_master_roadmap.md` §5:

1. **The prose block was never retroactively corrected.** When Agent Phase 2F/2G/4 work was actually completed, nobody went back and edited §19's "(deferred)" annotations, because doing so meant manually re-reading and re-writing free text. The ledger silently became wrong.
2. **There was no single field to diff.** Because each entry is a paragraph of prose, there is no machine-checkable way to ask "does this ledger entry's status match this Task file's checklist state?" A generator-based ledger fixes both problems: it is regenerated wholesale from source state, so it cannot silently drift, and every field is structured, so drift checks (per `pm_operating_model.md` §7.6) are mechanical.

---

## 2. Canonical Ledger Schema

The generated ledger is a single structured document (format below is given as the logical schema; the literal file format — Markdown table, JSON, YAML — is an implementation choice for whoever builds the generator, not fixed by this contract).

Each entry has exactly these fields:

| Field | Type | Source of Truth | Notes |
|---|---|---|---|
| `task_id` | string | Task filename (e.g. `MEMORY-FORGET-001`) | Must match the canonical prefixed form; bare/legacy IDs (`Concurrency`, `Fingerprint`) are not valid `task_id` values going forward — see §5. |
| `phase_id` | string (`P##`) | `docs/loom_master_roadmap.md` §2/§3 | Every entry must resolve to exactly one Phase ID. An entry with no resolvable Phase ID is itself a drift signal — see `pm_operating_model.md` §7.6. |
| `epic` | string | roadmap §3 Phase Tree | Free text label matching an Epic name under the resolved Phase. |
| `title` | string | Task file's `## Goal` heading | One line. |
| `state` | enum: `LOCKED` \| `ACTIVE` \| `NEXT` \| `HOLD-BACKLOG` | Computed per `pm_operating_model.md` §2 (aggregation rule) | Never hand-set; always recomputed from the Task's own checklist + the paired Test/QA checklists. |
| `checklist_total` | integer | Count of `- [ ]`/`- [x]` lines in the Task file | |
| `checklist_done` | integer | Count of `- [x]` lines in the Task file | |
| `blocked_by` | array of `task_id` | Task file's stated dependency, or inferred from roadmap §2 `Depends On` column | Empty array if unblocked. |
| `validation_evidence` | string or null | Task file's `## Validation Evidence` section | Must be present and non-null before `state` can be `LOCKED` (per `pm_operating_model.md` §5 rule 4). A `LOCKED` entry with `validation_evidence: null` is a contract violation. |
| `last_updated` | date | Task/Test/QA file mtime, latest of the three | Used for staleness/drift recency comparisons per `pm_operating_model.md` §7.6. |

---

## 3. Generation Rule

The generated ledger is produced by, conceptually, this procedure (again: this contract defines *what* the output must contain and how it's derived, not the implementation):

1. Enumerate every file in `_PM/Agent-PM/Tasks/*.md`. Each filename yields a candidate `task_id`.
2. For each `task_id`, locate the paired `Test_<task_id>_v*.md` and `QA_<task_id>_v*.md`. If either is missing, flag it (a Task without a paired Test or QA file is incomplete per the `AGENTS.md` §17 protocol, regardless of its own checklist state).
3. Compute `checklist_total`/`checklist_done` from the Task file's own checklist.
4. Resolve `phase_id` and `epic` by matching the `task_id` against `docs/loom_master_roadmap.md` §3's Phase Tree listings. If no match is found, the entry is emitted with `phase_id: UNRESOLVED` and must be surfaced for a human to either map it to an existing Phase or request a new one.
5. Compute `state` using `pm_operating_model.md` §2/§5 rules — not by copying a status string from anywhere.
6. Sort output by `phase_id`, then by `state` (`LOCKED` first, then `ACTIVE`, then `NEXT`, then `HOLD-BACKLOG`), then by `last_updated` descending within each group.

---

## 4. Backward Compatibility With the Existing Ledger File

`docs/loom_service_architecture_ledger.md` is not deleted or rewritten by this contract. Its non-roadmap sections (§1–§12, §15–§18: decisions, non-goals, target architecture, config direction, privacy rules, LibreChat alignment notes) remain the authoritative *decision* record — that content was never roadmap/status tracking and is out of scope for this rebase.

§13 (Phase Roadmap) and §14 (Task Ledger) and §19 (Agent Phase Roadmap) are **deprecated as of this contract**. They should be marked with a header note pointing to `docs/loom_master_roadmap.md` and this contract, but the prose itself can remain as a frozen historical snapshot — useful for understanding what the team believed at the time, even where later discovered to be wrong. Do not delete history to cover up the drift documented in roadmap §5; that drift is itself useful institutional memory about why this rebase happened.

Going forward, any task that would previously have triggered "update the ledger LOCKED/ACTIVE/NEXT block" (per `AGENTS.md` §12/§13/§15) should instead trigger "regenerate the ledger per this contract and update `docs/loom_master_roadmap.md` §2/§3 if a new Phase/Epic/Task was introduced." `AGENTS.md` itself is not amended by this document — that would be a separate, explicit task — but its existing reporting rules are satisfied by reporting against this contract's schema instead of free prose.

---

## 5. ID Hygiene Rule

Every `task_id` in the generated ledger must use the canonical prefixed form already established by convention across most of `_PM/Agent-PM/` (e.g. `MEMORY-FORGET-001`, `AGENT-RUN-PERSISTENCE-001`). Bare/unprefixed task names found during this rebase (`Concurrency`, `Fingerprint`, `RevisionPaging`, `RevisionResponseHighlightOnly`, `CrossPlatformBuild`, `Highlight_Regression`) are **legacy** and must not be treated as live `task_id` values in the generated ledger. Per `docs/loom_master_roadmap.md` §5 case 5, several of these appear to be superseded by canonically-prefixed IDs that are already `LOCKED` (e.g. `Fingerprint` → `SERVICE-BINARY-FINGERPRINT-001`). The generator should either:
- map them explicitly to their superseding canonical ID (preferred, where a clear successor exists), or
- emit them under a distinct `legacy: true` flag so they don't pollute completion-percentage math with stale 0%-complete noise.

Do not silently drop them — that would erase the audit trail of what was actually attempted under the old naming.

---

## 6. Changelog

- v1.0 (this document): Initial ledger contract created under ROADMAP-REBASE-001, defining the schema and generation rule that replaces hand-maintained ledger prose in `docs/loom_service_architecture_ledger.md` §13/§14/§19. No generator implementation is included — this is the contract a future implementation task must satisfy.
