# Agent Phase 2G: Context Selection Architecture Plan v1.0

## Objective

Design the Context Selection layer that sits between all context source providers and the
Context Manager.

Context Selection decides **priority, scoring, and inclusion order** across every source of
context available to a Loom agent turn. It receives signals from Hybrid Retrieval, the
conversation thread, Weft lineage, memories, attachments, and future sources (MCP/tool output,
Internet). It produces a typed, priority-ordered context payload that the Context Manager
consumes to perform token budget allocation and prompt assembly.

This document is **architecture and design only**. No implementation begins under this plan.

## Status

Deferred. Depends on HYBRID-RETRIEVAL-SERVICE-001 (Agent Phase 2E) and
RETRIEVAL-DIAGNOSTICS-001 (Agent Phase 2F).

## Changelog
- **v1.0**: Initial context selection architecture design (AGENT-CONTEXT-SELECTION-ARCH-001).

---

## 1. Why Context Selection is a Distinct Layer

Hybrid Retrieval (Phase 2E) performs lexical/semantic fusion over indexed projection candidates.
It returns `RetrievalResult` — a ranked list of `(source_kind, source_id, chunk_ref, score)`.

The Context Manager (Phase 3) owns token budgeting and final prompt assembly. It consumes a
typed context payload and decides what text appears in the prompt.

Neither of these layers can answer: **"given everything available to this agent turn, what
should be included, in what order, and with what priority?"**

- Hybrid Retrieval does not know about the conversation thread, Weft lineage, policy memory, or
  attachments. It is a text-relevance service over indexed projection sources only.
- Retrieval Diagnostics (Phase 2F) reports health/staleness/corruption of retrieval indexes.
  It does not select context.
- The Context Manager does not evaluate source priority across heterogeneous source types.
  It receives a prepared payload and applies token budget constraints.

Context Selection fills this gap. It is the single point where all context sources are
evaluated together and a coherent, prioritized payload is produced.

---

## 2. Context Source Taxonomy

The following source categories are defined in priority order. Priority reflects the default
relative weight of each source type. The ordering is not absolute — within a budget, higher-
priority sources are satisfied before lower-priority sources are trimmed.

### Category 1: Policy Memory / Always-Include Rules

Rules and memories that must appear in every agent turn regardless of query relevance or token
budget. These are injected before retrieval scoring begins.

Examples: system-level behavior constraints, user-confirmed always-include memory entries,
explicit operator policy entries.

These are **not scored** — they are mandatory inclusions. If they exceed the available token
budget, the budget must be expanded or the turn must be rejected, not silently dropped.

### Category 2: Current Conversation Thread

The active Loom's visible user/assistant response sequence up to the current turn. Ordered
by sequence index. Bounded by recency window (most recent first; older turns compressed into
capsules by the Context Builder).

This is always included. The recency window size is determined by the Context Manager's
`ContextBudgetPlan`.

### Category 3: Branch Lineage / Weft Origin Chain

For Weft Looms: the origin response, origin capsule, and hidden `weft_origin_contexts`
from the parent Loom chain. Not rendered as visible transcript — injected as hidden background
context only.

For non-Weft Looms: empty.

### Category 4: Current Project / Tab Group

Future: workspace-level context shared across all Looms in the current project or tab group.
Scoped above the individual Loom but below global.

Not yet implemented. Reserved as a source category for future tab-group awareness.

### Category 5: Scoped Memories

User-confirmed memories (`memories.user_confirmed = 1`) relevant to the current Loom or
topic. Ordered by Hybrid Retrieval score when available; otherwise by recency.

Distinct from Category 1 (policy/always-include): scoped memories are retrieved and scored,
not mandatory.

### Category 6: Conversation Attachments

Parsed attachment chunks (`attachment_parse_artifact_chunks`) linked to the current Loom.
Scored by Hybrid Retrieval when available; otherwise by chunk index.

Future implementation: attachments are a retrieval source but their inclusion is conditional
on relevance to the current query. Not unconditional like conversation thread.

### Category 7: Project / Tab-Group Attachments

Future: attachments shared at project or tab-group scope. Lower priority than per-conversation
attachments.

Not yet implemented. Reserved.

### Category 8: Hybrid Retrieval Candidates

`RetrievalResult.candidates` from `HybridRetrievalService.search()`. These are the
lexical/semantic relevance signals over all indexed projection sources (responses, memories,
capsules, checkpoints, references, attachment chunks).

Hybrid Retrieval candidates ranked below Category 1–7 sources by default — they supplement
the conversation/lineage context, not replace it. Their relative ordering within this category
is determined by `relevance_score` (RRF-fused, domain-rank-shifted).

### Category 9: Global Retrieval

Future: retrieval over all Looms in the workspace, not just the current Loom. Lower priority
than scoped/conversational retrieval.

Not yet implemented. Reserved.

### Category 10: Archived Retrieval

Future: retrieval over archived/closed Looms. Lowest-priority retrieval tier.

Not yet implemented. Reserved.

### Category 11: Internet / MCP / Tool-Derived Context

Future: context contributed by MCP tool calls, web search, or other external tool execution.
Injected as structured tool output artifacts, not as raw text.

Raw tool output must never appear in context without sanitization. Thinking text produced
during tool execution must never enter context. Not yet implemented. Reserved.

---

## 3. Context Selection Contracts

### Input

```
ContextSelectionRequest {
    query:              RetrievalQuery,        // the current turn's scrubbed query
    loom_id:            String,                // active Loom
    agent_run_id:       String,                // for audit seam (context_snapshot_id)
    budget_hint:        ContextBudgetHint,     // soft guidance from caller; CM applies hard budget
    mode:               ContextSelectionMode,  // Standard | CompactSummary | CodeFocused | etc.
}
```

### Output

```
ContextPayload {
    // Mandatory inclusions (Category 1)
    policy_entries:       Vec<PolicyContextEntry>,

    // Conversation (Category 2)
    conversation_turns:   Vec<ConversationTurn>,       // bounded recent turns
    compressed_capsules:  Vec<CapsuleEntry>,            // older turns as capsules
    checkpoints:          Vec<CheckpointEntry>,         // rolling summaries

    // Lineage (Category 3)
    weft_origin_context:  Option<WeftOriginContext>,    // hidden; not rendered in transcript

    // Memories (Category 5)
    scoped_memories:      Vec<ScoredMemoryEntry>,

    // Retrieval (Category 8)
    retrieval_candidates: Vec<ScoredRetrievalEntry>,   // from HybridRetrievalService

    // Diagnostics (no content; safe for audit)
    selection_diagnostics: ContextSelectionDiagnostics,

    // Future categories reserved but not populated:
    // tab_group_context, project_attachments, conversation_attachments,
    // global_retrieval, archived_retrieval, tool_derived
}
```

### What Context Selection does NOT do

- Does not fetch full content from SQLite (it works with `source_id` references; the Context
  Manager fetches content when assembling the prompt)
- Does not apply token budgets (it tags items with priority and estimated token cost; the
  Context Manager applies hard budget constraints)
- Does not assemble prompt text (it produces a typed payload, not a string)
- Does not write to memory (memory writes are a separate policy layer)
- Does not know about provider-specific prompt formats

---

## 4. Scoring Within Each Category

Categories are strict priority tiers: Category 1 is satisfied in full before Category 2 is
trimmed, Category 2 before Category 3, and so on.

Within a category, scoring is:
- **Mandatory (Category 1):** No scoring. All entries included.
- **Recency-ordered (Categories 2, 3):** Sequence index or timestamp, newest first.
- **Retrieval-scored (Categories 5, 6, 8):** `relevance_score` from `HybridRetrievalService`
  where available; recency as fallback.
- **Future (Categories 4, 7, 9, 10, 11):** Scoring TBD at implementation time.

Cross-category score comparison is not performed. A memory with retrieval score 0.9 does not
rank above a conversation turn simply because of its score — categories provide the ordering
guarantee.

---

## 5. Relationship to Existing Context Infrastructure

The existing `context/manager.rs`, `ContextBudgetPlan`, response capsules, and checkpoint
summaries are the **production implementation** of context selection for non-agent generation.
Context Selection for the Agent Runtime generalizes and formalizes the same logic.

- `ContextBudgetPlan` remains the Context Manager's internal sizing tool. Context Selection
  uses a `ContextBudgetHint` to request approximate sizes; the Context Manager applies the hard
  budget against the actual `ContextPayload`.
- Response capsules and checkpoint summaries (Categories 2 and 3) are already produced by the
  context build job system. Context Selection reads them; it does not produce them.
- `memories` are already indexed in the Hybrid Retrieval projection. Context Selection's
  Category 5 (scoped memories) uses retrieval scores for ordering, not re-implementing a
  separate memory lookup.

---

## 6. Privacy Invariants

All privacy rules established in the Retrieval Architecture (RETRIEVAL-ARCH-001) and the
Hybrid Retrieval Service (HYBRID-RETRIEVAL-SERVICE-001) apply to Context Selection:

- Raw thinking must never enter the `ContextPayload` in any category.
- Provider payloads, prompt envelopes, provider deltas, secrets, credentials, and raw
  reasoning must never appear.
- Agent run/event/step data is never a context selection source (audit trail, not knowledge).
- `ContextSelectionDiagnostics` follows the same privacy model as `RetrievalDiagnostics`:
  counts, types, and latency only — no query text, no content, no source identifiers.
- `weft_origin_context` is hidden context only — it must never be rendered as visible
  conversation transcript.

---

## 7. Rollout Notes

This plan defines the architecture only. Implementation is Agent Phase 3A (design) and
Agent Phase 3B (implementation), after RETRIEVAL-DIAGNOSTICS-001 (Phase 2F) is complete.

Future source categories (4, 7, 9, 10, 11) are reserved in the taxonomy but explicitly
deferred. The `ContextPayload` struct must be designed with extension points for these
categories without implementing them.

Attachment sources (Categories 6 and 7) are future implementation tasks. The current
attachment infrastructure (`attachment_parse_artifact_chunks`) is already an eligible
retrieval projection source — Context Selection for attachments can reuse Hybrid Retrieval
candidates rather than implementing a separate attachment lookup path.
