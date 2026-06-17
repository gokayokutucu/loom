# Agent Phase 3A: Context Manager Design Plan v1.0

## Objective

Design the Agent Context Manager — the layer that receives a typed `ContextPayload` from
Context Selection and produces a token-budgeted, prompt-ready context assembly.

The Context Manager owns:
- Token budget allocation across context categories
- Full content resolution from SQLite by candidate identity
- `ContextRetrievalIncludeMode` decisions (Full / Capsule / ReferenceOnly / CodeExact /
  CodeSummary) per candidate
- Prompt assembly order and format
- The `agent_runs.context_snapshot_id` audit seam

This document is **design only**. Implementation is Agent Phase 3B (AGENT-CONTEXT-MANAGER-001).

## Status

Deferred. Depends on AGENT-CONTEXT-SELECTION-ARCH-001 (Agent Phase 2G).

## Changelog
- **v1.0**: Initial Context Manager design (AGENT-CONTEXT-MANAGER-DESIGN-001).

---

## 1. Boundary with Context Selection

Context Selection (Phase 2G) produces a typed `ContextPayload` with:
- Priority-ordered entries across 11 source categories
- Per-entry: `(source_kind, source_id)` reference, estimated token cost, retrieval score,
  and a short text preview
- `ContextSelectionDiagnostics` (no content; audit-safe)

Context Manager receives this payload and:
1. Resolves full content from SQLite for each entry by `(source_kind, source_id)` — this is
   the only place full content is fetched from SQLite in the context pipeline
2. Applies `ContextRetrievalIncludeMode` to each resolved entry
3. Allocates token budget across categories using `ContextBudgetPlan`
4. Assembles the final prompt context string (or structured sections) for provider dispatch

Context Manager never:
- Calls Hybrid Retrieval directly (it receives retrieval candidates through `ContextPayload`)
- Makes source priority decisions (those are Context Selection's responsibility)
- Stores prompt text in SQLite (only the `context_snapshot_id` seam is recorded)
- Includes raw thinking, provider payloads, secrets, or agent audit trail content

---

## 2. Token Budget Allocation

The existing `ContextBudgetPlan` (already implemented for non-agent generation) allocates
token budget across context contributors. The Agent Context Manager reuses this model and
extends it for agent turns.

Budget allocation order follows Context Selection priority:
1. Policy entries (mandatory; budget must accommodate or turn is rejected)
2. Conversation turns (recent window; older turns use capsule/checkpoint budget)
3. Weft origin context (hidden; fixed budget allocation)
4. Scoped memories (scored; trim lowest-scored first when over budget)
5. Retrieval candidates (scored; trim lowest-scored first when over budget)

The output reserve (tokens budgeted for the assistant response) is calculated first and
subtracted from the total context window before any source allocation begins — matching
the existing `ContextBudgetPlan` behavior.

---

## 3. Include Mode Decisions

`ContextRetrievalIncludeMode` determines how much of each resolved source is included:

| Mode | When to apply |
|---|---|
| `Full` | Short content, explicitly referenced, or code source kinds |
| `Capsule` | Older responses where a capsule/checkpoint is available |
| `ReferenceOnly` | Items present for navigation/tracing but not needing full text |
| `CodeExact` | `response_code_blocks` when code relevance is detected |
| `CodeSummary` | Code blocks when only a summary is within budget |

The existing `code_relevance_detected` logic (from `CODE-CONTEXT-RETRIEVAL-001`) applies.
Context Manager carries this logic forward; Context Selection does not evaluate code
relevance.

---

## 4. Prompt Assembly Contract

The Context Manager produces a structured context assembly, not a raw string. Each section
is labeled by source category and include mode:

- Policy entries: injected first, without label (they appear as system-level context)
- Weft origin context: injected as hidden background (marked not to render as transcript)
- Conversation turns: recent turns in role-labeled order (user/assistant)
- Compressed capsules and checkpoints: as background summary sections
- Memory entries: labeled as background knowledge
- Retrieval candidates: labeled by source kind

The exact prompt format (XML tags, Markdown sections, or plain text delimiters) is deferred
to Phase 3B implementation and depends on provider contract requirements at that time.

---

## 5. Context Snapshot Audit Seam

`agent_runs.context_snapshot_id` (nullable column, migration 0022) is the reserved seam
for attaching a context snapshot to an agent run.

When the Context Manager assembles context for an agent turn, it writes a minimal, content-
free context snapshot:
- Which source categories were included and how many items from each
- Total token allocation per category
- `RetrievalDiagnostics` summary (counts and health only, no content)
- `ContextSelectionDiagnostics` summary

This snapshot is stored by reference in `agent_runs.context_snapshot_id`. It is not a copy
of the prompt — it is a diagnostic artifact, following the same privacy model as
`agent_events`: counts, types, and latency only.

---

## 6. Relationship to Existing ContextManager

The existing `src/context/manager.rs` is the non-agent production implementation. The Agent
Context Manager (Phase 3B) will:
- Share the `ContextBudgetPlan` contract
- Reuse capsule/checkpoint loading repositories
- Reuse `ContextRetrievalIncludeMode` logic
- Not replace or duplicate the existing ContextManager for non-agent generation flows

The two managers coexist. The Agent Context Manager is an agent-turn-specific implementation
that consumes the Context Selection `ContextPayload` interface. The non-agent ContextManager
continues to serve Main composer and Quick Ask generation unchanged.

---

## 7. Privacy Invariants

- Raw thinking must never enter the assembled context.
- Provider payloads, prompt envelopes, secrets, credentials, and raw reasoning are excluded
  structurally (SQLite never stored them; full content resolution from SQLite inherits the
  write-time guards).
- Agent run/event/step audit data is never a content source.
- Context snapshots stored via `context_snapshot_id` contain no prompt text, no content, and
  no source identifiers — only counts, types, and diagnostics.
- Weft origin context injected as hidden background must never appear in visible transcript
  hydration or agent event payloads.

---

## 8. Rollout Notes

This plan defines the design only. Implementation is Agent Phase 3B
(AGENT-CONTEXT-MANAGER-001), which depends on:
- AGENT-CONTEXT-SELECTION-ARCH-001 (Phase 2G) — design accepted
- HYBRID-RETRIEVAL-SERVICE-001 (Phase 2E) — complete
- RETRIEVAL-DIAGNOSTICS-001 (Phase 2F) — complete

Memory write policy (AGENT-MEMORY-001) and attachment implementation tasks are separate
and explicitly deferred beyond Phase 3.
