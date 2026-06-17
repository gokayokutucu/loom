# Agent Phase 2: Context Selection Contract Design v1.0

## Task ID

CONTEXT-SELECTION-CONTRACT-DESIGN-001

## Objective

Finalize the complete Context Selection service contract before AGENT-CONTEXT-SELECTION-ARCH-001
implementation begins. This document answers the twelve open questions from the task brief and
produces exact, implementation-ready contract shapes for every type that crosses the boundary
between Scope Resolution, Hybrid Retrieval, Context Selection, and Context Manager.

This document is **design and spec only**. No code, no migrations, no runtime changes.

## Status

Design only. Depends on:
- HYBRID-RETRIEVAL-SERVICE-001 (Agent Phase 2E) — complete
- RETRIEVAL-DIAGNOSTICS-001 (Agent Phase 2F) — complete
- SCOPE-RESOLUTION-DESIGN-001 — complete
- SCOPE-RESOLUTION-001 — complete

Implementation is AGENT-CONTEXT-SELECTION-ARCH-001 (Agent Phase 2G).

## Changelog
- **v1.0**: Initial Context Selection contract design (CONTEXT-SELECTION-CONTRACT-DESIGN-001).

---

## 1. Answered: How ScopeContext and RetrievalResult Combine

`ScopeContext` and `RetrievalResult` are produced independently and arrive at Context Selection
as two separate inputs. They are combined inside Context Selection — nowhere else.

**`ScopeContext` contributes:**
- The 11-tier priority structure: which scope types are active, empty, or reserved.
- The loom allowlists per tier: which `loom_id`s are in scope for Tiers 8, 9, 10.
- Weft detection and visibility flags: `weft_loom_detected`, per-scope `is_hidden_background`.
- Memory eligibility: counts and type distribution (no content) for Tiers 5a/5b.
- Attachment eligibility: count of `parse_status = 'ready'` attachments for Tier 6.
- Explicit reference IDs: which current-turn References are mandatory (Tier 1).

**`RetrievalResult` contributes:**
- Ranked `RetrievalCandidate` lists from Hybrid Retrieval, one per issued query:
  - Tier 8 query: `loom_ids = ScopeContext.scoped_retrieval_loom_ids`
  - Tier 9 query: `loom_ids = ScopeContext.cross_conversation_loom_ids`
  - Tier 10 query: `loom_ids = ScopeContext.archived_retrieval_loom_ids`
- Per-candidate: `source_kind`, `source_id`, `chunk_ref`, `relevance_score`, `rank_signals`,
  `text_preview`, `loom_id`, `response_id`.

**How Context Selection combines them:**

1. For each `RetrievalCandidate`, assign a `ContextSourceTier` by matching its `loom_id`
   against the loom allowlists from `ScopeContext`:
   - `loom_id ∈ scoped_retrieval_loom_ids` → Tier 8
   - `loom_id ∈ cross_conversation_loom_ids` → Tier 9
   - `loom_id ∈ archived_retrieval_loom_ids` → Tier 10
   - `source_kind = "memory" AND source_loom_id = active_loom_id` → Tier 5a (overrides Tier 8)
   - `source_kind = "memory" AND source_loom_id IS NULL` → Tier 5b (overrides Tier 8)
   - `source_kind = "attachment_chunk" AND loom_id = active_loom_id` → Tier 6 (overrides Tier 8)

2. For Tier 2 (ConversationThread), Tier 3 (WeftOriginChain), and Tier 1 (PolicyAlwaysInclude),
   Context Selection makes bounded SQLite reads against response metadata (not full content)
   and uses `ScopeContext` lineage data — Hybrid Retrieval is not called for these tiers.

3. Within each tier, apply the within-tier ordering rules (see §5).

4. Pack all results into `ContextPayload` fields in priority order.

---

## 2. What Is a ContextCandidate?

A `ContextCandidate` is the atomic unit of `ContextPayload`. It is a typed reference to a
piece of content in SQLite — **not the content itself**. The Context Manager resolves full
content later using the identity fields.

Every `ContextCandidate` carries:

**Identity (mandatory; enables SQLite resolution):**
- `source_kind: String` — the source table category: `response`, `memory`, `attachment_chunk`,
  `response_capsule`, `checkpoint`, `reference`, `weft_origin`. Matches the retrieval
  projection vocabulary.
- `source_id: String` — the primary key of the owning SQLite row.
- `chunk_ref: Option<String>` — for chunked sources (attachment chunks, sub-response parts);
  `None` for whole-row sources.

**Tier placement:**
- `tier: ContextSourceTier` — the 11-tier enum value assigned by Context Selection.
- `tier_priority: u8` — integer 1–11 derived deterministically from `tier`. Redundant with
  `tier` but useful for sort-key operations in Context Manager without pattern-matching.

**Scoring and ordering:**
- `retrieval_score: Option<f32>` — from `RetrievalCandidate.relevance_score` for retrieval-
  scored candidates (Tiers 5–10). `None` for structural candidates (Tiers 1–3) which are
  not scored by Hybrid Retrieval.
- `within_tier_rank: u32` — the final rank of this candidate within its tier, after all
  within-tier signals (retrieval score, memory type weight, recency, code sub-signal) are
  applied. 1 = highest priority within the tier.

**Token estimate (advisory):**
- `estimated_tokens: usize` — a lightweight estimate for budget guidance. Derived from
  `text_preview.len() / 4` for retrieval candidates, or from `LENGTH(content) / 4` for
  conversation thread candidates where a metadata-only SQLite query is made.
  This is advisory only. Context Manager applies its own token estimation when resolving
  full content.

**Include mode advisory:**
- `include_mode_hint: ContextIncludeModeHint` — advisory to Context Manager. Context
  Manager may override based on hard token budget constraints. See §6.

**Visibility flags:**
- `is_hidden_background: bool` — `true` for all Weft origin chain candidates (Tier 3).
  Set by Context Selection from `ScopeContext.scopes[WeftOriginChain].visibility`.
  Must never be cleared by downstream layers.
- `is_mandatory: bool` — `true` for Tier 1 (PolicyAlwaysInclude) candidates. Context
  Manager must include these in full regardless of token budget. If mandatory candidates
  alone exceed the budget, the turn must be rejected, not silently truncated.

**Reference annotation:**
- `is_explicit_reference: bool` — `true` when this candidate originated from
  `ScopeContext.CurrentConversation.explicit_reference_ids` (current-turn composer
  References). These are always `is_mandatory = true` and are placed in Tier 1.

**Diagnostic signal:**
- `text_preview: Option<String>` — at most 240 characters from `RetrievalCandidate.text_preview`.
  `None` for structural candidates (Tier 2 conversation turns, Tier 3 Weft lineage) where
  no retrieval preview is available. Must never contain forbidden content (same 20-marker
  rejection list as retrieval adapters).
- `rank_signals: Option<RankSignals>` — from `RetrievalCandidate.rank_signals` for retrieval
  candidates; `None` for structural candidates. Carries BM25/vector scores for diagnostics
  surface only; not for product display.

---

## 3. Identity Fields vs Diagnostic Fields

### Identity fields — Context Manager resolves content from these

| Field | Required for resolution? | Notes |
|---|:---:|---|
| `source_kind` | Yes | Determines which SQLite table to query |
| `source_id` | Yes | Primary key; joins to source table |
| `chunk_ref` | Conditional | Required for attachment chunks and sub-document parts |
| `tier` | Yes | Determines priority ordering |
| `is_mandatory` | Yes | Determines budget rejection vs. truncation |
| `is_hidden_background` | Yes | Determines transcript vs. background injection |
| `is_explicit_reference` | Yes | Determines Tier 1 mandatory inclusion |
| `include_mode_hint` | Advisory | Context Manager may override |
| `estimated_tokens` | Advisory | Context Manager re-estimates from full content |

### Diagnostic fields — observability and inspector surface only

| Field | Notes |
|---|---|
| `retrieval_score` | From Hybrid Retrieval; safe for diagnostics surface |
| `within_tier_rank` | Computed by Context Selection; safe for diagnostics surface |
| `rank_signals` | BM25/vector signals from Hybrid Retrieval; never product-displayed |
| `text_preview` | Bounded preview; must pass forbidden-marker check before inclusion |

Diagnostic fields must never flow into prompt assembly. They are recorded in
`ContextSelectionDiagnostics` and the future context snapshot (`agent_runs.context_snapshot_id`),
not in the assembled prompt.

---

## 4. Tier Priority Encoding

`ContextSourceTier` is the canonical encoding. `tier_priority` is derived from it.

```
enum ContextSourceTier {
    PolicyAlwaysInclude,            // 1  — mandatory; never scored; never skipped
    ConversationThread,             // 2  — recency-ordered; always populated
    WeftOriginChain,                // 3  — hidden background; Weft Looms only
    ProjectGroup,                   // 4  — reserved
    ScopedMemory,                   // 5a — retrieval-scored; user_confirmed=1, scoped
    GlobalMemory,                   // 5b — retrieval-scored; user_confirmed=1, global
    ConversationAttachment,         // 6  — retrieval-scored; loom-linked attachments
    ProjectAttachment,              // 7  — reserved
    ScopedRetrieval,                // 8  — retrieval-scored; current Loom
    CrossConversationRetrieval,     // 9  — retrieval-scored; cross-Loom; capped
    ArchivedRetrieval,              // 10 — retrieval-scored; archived Looms; capped lower
    ToolMcpContext,                 // 11 — reserved
}
```

Tier priority rules enforced by Context Selection and Context Manager:

1. Tier N is always satisfied before Tier N+1 is trimmed.
2. Within a tier, `within_tier_rank` determines inclusion order.
3. Cross-tier score comparison is never performed. A memory with `retrieval_score = 0.99`
   does not outrank a conversation turn, regardless of score.
4. `is_mandatory = true` (Tier 1) candidates are never trimmed. If they overflow the budget,
   the turn is rejected with a budget error.
5. Tier 1 does not have a `retrieval_score` — it is not a retrieval tier. Mandatory entries
   have no score field populated.

---

## 5. Always-Include Entries

In v1.0, the following are always-include (Tier 1) entries:

**5.1 Explicit current-turn References**

Source: `ScopeContext.CurrentConversation.explicit_reference_ids` (validated `reference_id`
values from the current composer turn). Each becomes a `ContextCandidate` with:
- `tier = PolicyAlwaysInclude`
- `is_mandatory = true`
- `is_explicit_reference = true`
- `source_kind = "reference"`, `source_id = reference_id`
- `include_mode_hint = Full` (user actively attached them; full content is appropriate)

**5.2 System prompt / operator instructions**

If the agent configuration carries a system prompt, it is passed through `ContextPayload`
as a `PolicyEntry` (not a `ContextCandidate`) because it does not have a SQLite identity.
Context Manager injects it directly as the first prompt section.

```
PolicyEntry {
    policy_kind: PolicyKind,  // SystemPrompt | OperatorInstruction
    content: String,          // already assembled; no SQLite resolution needed
    estimated_tokens: usize,
}
```

Policy entries are separate from `ContextCandidate` because they carry content directly
(they are not resolved from SQLite by identity). They are mandatory and always injected
first.

**5.3 What is NOT in Tier 1 in v1.0**

- "Always-include memory entries": the existing `memories` table does not have an
  `always_include` column. This concept is deferred to Phase 4 (Memory Policy Engine).
  When Phase 4 lands, it will contribute filtered memory entries to Tier 1 via a new
  column or a memory policy evaluation step — no redesign of this contract is required,
  only adding entries to `policy_entries`.
- The current turn's user prompt: the user prompt is provided directly by the orchestrator
  and is injected by Context Manager as a protected input — it is not selected by Context
  Selection. Context Selection does not need to represent it in `ContextPayload`.

---

## 6. Hidden Background Context

All candidates with `is_hidden_background = true` must be treated uniformly by Context
Manager:

- Never rendered as a visible conversation turn.
- Never injected between visible user/assistant pairs as if it were part of the dialogue.
- Always injected as a system-level background section before the visible transcript.
- The section is labeled in a way that is invisible to the user (e.g. XML/Markdown system
  tag understood by the provider's prompt format).

Context Selection sets `is_hidden_background = true` for:
- All candidates in Tier 3 (`WeftOriginChain`): origin response, origin capsule,
  `weft_origin_contexts` content.
- Future: any tool output (Tier 11) flagged as background by the tool runtime.

Context Selection never clears `is_hidden_background`. Once set, it propagates unchanged
through to prompt assembly.

**Weft origin context in `ContextCandidate`:**

Each Weft origin level produces candidates of the following `source_kind`s:
- `source_kind = "response_capsule"`, `source_id = origin_capsule_id` — the capsule
  summarizing the origin response.
- `source_kind = "weft_origin"`, `source_id = weft_origin_context_id` — the hidden
  `weft_origin_contexts` entry.

Both carry `is_hidden_background = true` and `tier = WeftOriginChain`.

---

## 7. Estimated Token Representation

`estimated_tokens: usize` in `ContextCandidate` is a lightweight estimate only. It is
used by the `ContextBudgetHint` caller to determine whether to issue optional Tier 9/10
retrieval queries. Context Manager does not trust this estimate for hard budget decisions
— it re-computes token estimates from fully resolved content.

**Derivation rules:**
- Retrieval candidates: `text_preview.len() / 4` (chars, not bytes; UTF-8 safe if using
  `.chars().count()`)
- Conversation thread candidates: `response_metadata.content_length / 4` (from a
  metadata-only SQLite query: `SELECT LENGTH(content) FROM responses WHERE response_id = ?`)
- Reference candidates: `0` (unknown without fetching; Context Manager resolves)
- Weft origin chain candidates: `0` (unknown without fetching; Context Manager resolves)
- Policy entries: populated directly by the caller with actual content length

**Aggregate estimate in `ContextSelectionDiagnostics`:**

`total_estimated_tokens: usize` is the sum of all selected candidates' `estimated_tokens`.
This is the number the orchestrator uses to decide whether to issue Tier 9 / Tier 10
retrieval queries (i.e., whether estimated budget remains after Tier 8 is satisfied).

---

## 8. Explicit Reference Representation

Explicit References appear in two places in `ContextPayload`:

**Tier 1 (PolicyAlwaysInclude) — current-turn mandatory References:**
- Source: `ScopeContext.CurrentConversation.explicit_reference_ids`
- These are References the user attached to the current composer turn.
- `is_mandatory = true`, `is_explicit_reference = true`, `tier = PolicyAlwaysInclude`
- `include_mode_hint = Full`
- Context Manager fetches full `references` row content (selected text + label) by
  `source_id = reference_id`.

**Tier 8 (ScopedRetrieval) — background References from retrieval:**
- Source: Hybrid Retrieval candidates with `source_kind = "reference"` scoped to the
  active Loom.
- These are earlier-turn References that were retrieval-indexed as part of the retrieval
  projection (`eligible_source_kinds` includes `"reference"`).
- `is_mandatory = false`, `is_explicit_reference = false`, `tier = ScopedRetrieval`
- Within Tier 8, retrieval-discovered References receive a `reference_weight` multiplier
  applied before `within_tier_rank` is computed:
  `adjusted_score = retrieval_score × 1.5`
  This is a within-tier-only adjustment; it never promotes a Reference across tier
  boundaries.

---

## 9. Memory Candidate Representation

Memory candidates arrive as `RetrievalCandidate` entries with `source_kind = "memory"`.

**Tier assignment by `loom_id`:**
- `candidate.loom_id = Some(active_loom_id)` → `tier = ScopedMemory` (Tier 5a)
- `candidate.loom_id = None` → `tier = GlobalMemory` (Tier 5b)
- `candidate.loom_id = Some(other_loom_id)` → excluded from ContextPayload in v1.0
  (cross-Loom memories are not a supported scope in v1.0; see §12)

**Within-tier ordering for Tier 5:**
`within_tier_rank` is determined by:
```
adjusted_score = retrieval_score × memory_type_weight(source)
```
where `memory_type_weight`:
- `explicit_user_memory` → 1.2
- `inferred_preference` (user_confirmed = 1) → 1.0

Context Selection must determine `memory_type` for each memory candidate. Since
`RetrievalCandidate` does not carry `memory_type`, Context Selection performs a
bounded metadata query:
```sql
SELECT memory_id, memory_type FROM memories
WHERE memory_id = ? AND user_confirmed = 1 AND deleted_at IS NULL
```
This is the only additional SQLite read Context Selection makes for retrieval candidates.
It is a primary-key lookup (fast). If the record is not found or `user_confirmed = 0`,
the candidate is dropped silently (the projection may be stale relative to a memory
deletion).

**`include_mode_hint` for memory candidates:** `Full` (memory entries are typically short;
the context continuity architecture treats them as exact content, not summaries).

---

## 10. Conversation Attachment and Project Attachment Representation

**Conversation Attachments (Tier 6):**
- Source: `RetrievalCandidate` entries with `source_kind = "attachment_chunk"` where
  `candidate.loom_id = Some(active_loom_id)`.
- Context Selection verifies `parse_status = 'ready'` via:
  ```sql
  SELECT parse_status FROM attachments WHERE attachment_id = ? AND loom_id = ?
  ```
  Candidates from attachments with `parse_status != 'ready'` are dropped.
  (This is a safety check; the retrieval projection already excludes non-ready chunks,
  but an incremental-index lag may produce stale candidates.)
- `tier = ConversationAttachment`, `within_tier_rank` by `retrieval_score`.
- `include_mode_hint = Full` for short chunks; `Capsule` advisory for chunks > 500
  estimated tokens.

**Project Attachments (Tier 7):**
- Reserved. No `ProjectAttachment` candidates are produced in v1.0.
- `TierDiagnostic` for Tier 7 is always emitted with `status = Reserved`.

**Attachment chunk identity:**
`source_kind = "attachment_chunk"` candidates use `source_id` as the
`attachment_parse_artifact_chunk.chunk_id` primary key and `chunk_ref` as the
deterministic chunk identity from the retrieval projection. Context Manager fetches
`attachment_parse_artifact_chunks.content_text` by `chunk_id`.

---

## 11. What Must Never Appear in ContextPayload

The following must never appear in any field of any `ContextCandidate` or `PolicyEntry`
in `ContextPayload`. Violations are bugs, not policy warnings.

**Content categories:**
1. Raw model thinking / chain-of-thought / hidden reasoning in any field.
   Forbidden markers: `raw_thinking`, `thinking_text`, `chain_of_thought`,
   `hidden_reasoning`, `rawThinking`, `thinkingText`, `chainOfThought`, `hiddenReasoning`.
2. Provider payloads, request envelopes, response deltas:
   `provider_delta`, `providerDelta`, `provider_payload`, `providerPayload`.
3. Secrets, credentials, API keys:
   `Authorization`, `Bearer `, `apiKey`, `api_key`, `password`, `credential`, `secret`, `sk-`.

**Source categories:**
4. Agent audit trail content: `agent_runs`, `agent_events`, `agent_steps` must never be
   `source_kind` values. No candidate with these source kinds may enter `ContextPayload`.
5. Unconfirmed memories (`user_confirmed = 0`): excluded at both Scope Resolution and
   Context Selection layers.
6. Deleted responses (`is_deleted = 1`): excluded at projection time; Context Selection
   drops any conversation-thread candidate where a metadata check reveals `is_deleted = 1`.
7. Stale/superseded responses (`deleted_reason = "retry_from_user_message"`): excluded.
8. Attachment content with `parse_status != 'ready'`: excluded at Context Selection.
9. Raw tool output (Tier 11): reserved; nothing may populate Tier 11 in v1.0.

**In `text_preview` specifically:**
The same 20 forbidden markers already enforced by retrieval adapters apply.
`text_preview` must pass `contains_forbidden_marker()` before being included in
`ContextCandidate`. A preview that fails is set to `None`; the candidate is not dropped.

**In diagnostics specifically:**
`ContextSelectionDiagnostics` must never carry: query text, Loom names, response titles,
memory content, source IDs, `content_digest` values. Counts and types only.

---

## 12. Contract Shapes

### ContextSelectionRequest

```
ContextSelectionRequest {
    // Scope universe (from Scope Resolution)
    scope_context:  ScopeContext,

    // Query context (scrubbed; no raw user input)
    query:          String,           // scrubbed query text for code-relevance detection
    query_intent:   QueryIntentKind,  // EntityFactual | Code | Temporal | Decision |
                                      // FileDocument | General

    // Agent run identity
    agent_run_id:   String,

    // Budget guidance (soft; CM applies hard budget)
    budget_hint:    ContextBudgetHint,

    // Selection mode
    mode:           ContextSelectionMode,
}

ContextBudgetHint {
    approximate_input_budget: usize,   // estimated tokens available for all context
    max_retrieval_candidates: usize,   // per-tier cap on retrieval candidates (e.g. 10)
    cross_loom_candidate_cap: usize,   // hard cap for Tier 9 (suggested: 5)
    archived_candidate_cap:   usize,   // hard cap for Tier 10 (suggested: 3)
}

enum ContextSelectionMode {
    Standard,       // normal selection across all tiers
    CompactSummary, // prefer capsules/checkpoints; reduce conversation thread depth
    CodeFocused,    // promote code candidates within tiers (equivalent to QueryIntentKind::Code)
}
```

### ContextSourceTier

```
enum ContextSourceTier {
    PolicyAlwaysInclude,            // 1
    ConversationThread,             // 2
    WeftOriginChain,                // 3
    ProjectGroup,                   // 4  reserved
    ScopedMemory,                   // 5a → encoded as 5
    GlobalMemory,                   // 5b → encoded as 5 (lower within-tier priority)
    ConversationAttachment,         // 6
    ProjectAttachment,              // 7  reserved
    ScopedRetrieval,                // 8
    CrossConversationRetrieval,     // 9
    ArchivedRetrieval,              // 10
    ToolMcpContext,                 // 11 reserved
}
```

`tier_priority()` on this enum returns u8: 1–11. `ScopedMemory` and `GlobalMemory` both
return 5. Within-tier ordering between the two is enforced by `within_tier_rank`:
all `ScopedMemory` candidates rank before all `GlobalMemory` candidates of equal adjusted
score.

### ContextIncludeModeHint

```
enum ContextIncludeModeHint {
    Full,         // prefer full content (short content; explicit references; memories)
    Capsule,      // prefer capsule/checkpoint summary (older conversation turns)
    ReferenceOnly, // identity only; no content needed (navigation/tracing only)
    CodeExact,    // prefer exact code block content
    CodeSummary,  // prefer code block id/language/hash summary only
}
```

This extends and aligns with the existing `ContextRetrievalIncludeMode` in
`context/retrieval.rs`. When Context Manager receives a `ContextCandidate`, it uses this
hint as the starting point for `ContextRetrievalIncludeMode` selection, then may override
based on remaining token budget.

### ContextCandidate

```
ContextCandidate {
    // Identity
    source_kind:     String,           // matches retrieval projection vocabulary
    source_id:       String,           // primary key for SQLite content resolution
    chunk_ref:       Option<String>,   // for chunked sources

    // Tier
    tier:            ContextSourceTier,
    tier_priority:   u8,               // 1–11

    // Ordering
    retrieval_score:  Option<f32>,     // None for structural candidates (Tiers 1–3)
    within_tier_rank: u32,             // 1 = highest priority within tier

    // Token estimate (advisory)
    estimated_tokens: usize,

    // Include mode (advisory)
    include_mode_hint: ContextIncludeModeHint,

    // Visibility
    is_hidden_background:  bool,
    is_mandatory:          bool,
    is_explicit_reference: bool,

    // Diagnostic (not for prompt assembly)
    text_preview:   Option<String>,    // ≤240 chars; None if forbidden or unavailable
    rank_signals:   Option<RankSignals>, // BM25/vector signals from retrieval
}
```

### PolicyEntry

```
PolicyEntry {
    policy_kind:      PolicyKind,   // SystemPrompt | OperatorInstruction
    content:          String,       // fully assembled; no SQLite resolution
    estimated_tokens: usize,
}

enum PolicyKind {
    SystemPrompt,         // system-level agent instructions
    OperatorInstruction,  // operator-provided behavioral constraints
}
```

### ContextPayload

```
ContextPayload {
    // Active agent turn identity
    active_loom_id: String,
    agent_run_id:   String,

    // Tier 1: always-include (mandatory, ordered by insertion; no scoring)
    policy_entries:          Vec<PolicyEntry>,      // system prompt, operator instructions
    mandatory_references:    Vec<ContextCandidate>, // is_mandatory=true, is_explicit_reference=true

    // Tier 2: conversation thread (recency-ordered; no retrieval score)
    conversation_turns:      Vec<ContextCandidate>, // sequence_index DESC; is_mandatory=false

    // Tier 3: Weft origin chain (hidden background; lineage_depth ASC)
    weft_origin_chain:       Vec<ContextCandidate>, // is_hidden_background=true; Weft Looms only

    // Tier 4: project group (reserved; always empty)
    // [no field; represented only in diagnostics]

    // Tier 5: memories (retrieval-scored; ScopedMemory before GlobalMemory)
    scoped_memories:         Vec<ContextCandidate>, // source_loom_id = active_loom_id
    global_memories:         Vec<ContextCandidate>, // source_loom_id IS NULL

    // Tier 6: conversation attachments (retrieval-scored)
    conversation_attachments: Vec<ContextCandidate>,

    // Tier 7: project attachments (reserved; always empty)
    // [no field; represented only in diagnostics]

    // Tier 8: scoped retrieval (current Loom, retrieval-scored)
    scoped_retrieval:        Vec<ContextCandidate>,

    // Tier 9: cross-conversation retrieval (capped; retrieval-scored)
    cross_conversation_retrieval: Vec<ContextCandidate>,

    // Tier 10: archived retrieval (capped lower than Tier 9; retrieval-scored)
    archived_retrieval:      Vec<ContextCandidate>,

    // Tier 11: tool/MCP context (reserved; always empty)
    // [no field; represented only in diagnostics]

    // Query context
    query_intent:              QueryIntentKind,
    code_relevance_detected:   bool,
    weft_loom:                 bool,

    // Diagnostics
    selection_diagnostics:     ContextSelectionDiagnostics,
}
```

Absent reserved tiers (4, 7, 11) are not struct fields. They appear as `Reserved` entries
in `ContextSelectionDiagnostics.tiers`. This avoids empty `Vec<ContextCandidate>` fields
for tiers that will never be populated in v1.0 and keeps the struct forward-compatible: when
a reserved tier is implemented, a new field is added to `ContextPayload` and its tier
diagnostic changes from `Reserved` to `Populated`/`Empty`.

---

## 13. ContextSelectionDiagnostics

```
ContextSelectionDiagnostics {
    // Per-tier accounting (no content, no source IDs)
    tiers: Vec<TierDiagnostic>,

    // Aggregate
    total_candidates_evaluated: usize,
    total_candidates_selected:  usize,
    total_estimated_tokens:     usize,  // sum of selected candidates' estimated_tokens

    // Signal flags
    code_relevance_detected:   bool,
    query_intent:              QueryIntentKind,
    weft_loom:                 bool,
    weft_lineage_depth:        u8,      // 0 if not a Weft Loom
    explicit_references_count: usize,   // Tier 1 mandatory reference count

    // Cross-Loom retrieval
    cross_loom_retrieval_activated:       bool,
    cross_loom_candidates_before_cap:     usize,
    cross_loom_candidates_after_cap:      usize,

    // Archived retrieval
    archived_retrieval_activated:         bool,
    archived_candidates_before_cap:       usize,
    archived_candidates_after_cap:        usize,

    // Memory
    scoped_memory_candidates:             usize,
    global_memory_candidates:             usize,
    memory_type_weight_applied:           bool,

    // Attachment
    attachment_candidates:                usize,
    attachment_parse_status_drops:        usize, // dropped due to parse_status check

    // Latency
    scope_resolution_latency_ms:          u64,   // received from ScopeResolutionDiagnostics
    retrieval_latency_ms:                 u64,   // received from RetrievalDiagnostics
    selection_latency_ms:                 u64,   // Context Selection own processing time
    total_pipeline_latency_ms:            u64,   // end-to-end from request to ContextPayload
}

TierDiagnostic {
    tier:                ContextSourceTier,
    tier_number:         u8,              // 1–11
    status:              TierDiagnosticStatus,
    candidates_evaluated: usize,
    candidates_selected:  usize,
    budget_hint_limited:  bool,           // candidates dropped due to budget_hint cap
    estimated_tokens:     usize,          // sum of selected candidates in this tier
}

enum TierDiagnosticStatus {
    Populated,   // has selected candidates
    Empty,       // no eligible candidates found
    Skipped,     // tier not queried (budget exhausted before this tier)
    Reserved,    // tier type not implemented in v1.0
}
```

### What ContextSelectionDiagnostics must NOT contain

- Query text
- Loom names or IDs
- Response titles or IDs
- Memory content or labels
- Attachment names or content
- `source_id` values
- `content_digest` values
- Raw `text_preview` text
- `rank_signals` raw scores (these stay in `ContextCandidate`, not in diagnostics)

### Context Snapshot Seam

`ContextSelectionDiagnostics` (counts and latency only) is the safe payload that gets
persisted as part of the context snapshot referenced by `agent_runs.context_snapshot_id`.
It does not carry content. It is safe for the agent run inspector surface.

---

## 14. Handoff Boundary to Context Manager

### What Context Selection hands off

`ContextPayload` is the complete handoff. It contains:
- `policy_entries` (pre-assembled system content; no SQLite resolution needed)
- `mandatory_references` (Tier 1 References; Context Manager resolves from `references`
  table by `source_id`)
- `conversation_turns` (Tier 2; Context Manager resolves from `responses` table by
  `source_id`)
- `weft_origin_chain` (Tier 3; Context Manager resolves from `weft_origin_contexts` and
  `response_context_capsules` by `source_id`; injects as hidden background)
- All retrieval-scored tiers (5a, 5b, 6, 8, 9, 10; Context Manager resolves from
  source-kind-appropriate SQLite tables by `source_id`)
- `selection_diagnostics` (counts and latency; persisted to context snapshot)

### What Context Manager does with it

1. **Content resolution:** For each `ContextCandidate`, fetches full content from SQLite
   using `(source_kind, source_id, chunk_ref)` as the join key. This is the only place
   full content is fetched in the entire agent context pipeline.

2. **Include mode application:** Uses `include_mode_hint` as the starting point. May
   downgrade `Full → Capsule → ReferenceOnly` based on remaining token budget.

3. **Token budget allocation:** Applies `ContextBudgetPlan` across candidates in tier
   order (1 → 2 → 3 → 5a → 5b → 6 → 8 → 9 → 10). Tier 1 is never trimmed. Budget
   pressure causes trimming starting from the highest-numbered tier.

4. **Prompt assembly:** Assembles prompt sections from resolved content:
   - Tier 1 (policy entries): injected first as system-level context.
   - Tier 3 (Weft origin chain): injected as hidden background section
     (`is_hidden_background = true`); never rendered as visible transcript.
   - Tiers 2, 5–10: injected in priority order as conversation context.
   - Current user prompt: injected last (provided by orchestrator; not in `ContextPayload`).

5. **Context snapshot write:** Writes a content-free summary (counts, tier breakdown,
   latency) to `agent_runs.context_snapshot_id` via the reserved migration 0022 column.

### What Context Manager must never do

- Call Hybrid Retrieval Service.
- Make source priority decisions (tier membership is already decided by Context Selection).
- Modify `is_hidden_background` or `is_mandatory` flags.
- Include Weft origin context in the visible transcript.
- Include raw thinking, agent audit data, or secrets.
- Store prompt text in SQLite (only the content-free diagnostic snapshot is persisted).

---

## 15. Responsibility Matrix

| Concern | Scope Resolution | Hybrid Retrieval | Context Selection | Context Manager |
|---|:---:|:---:|:---:|:---:|
| Discover which Looms are in scope | ✅ | — | — | — |
| Produce loom allowlists per tier | ✅ | — | — | — |
| Set `is_hidden_background` flag | ✅ produces it | — | ✅ propagates | ✅ enforces |
| Evaluate text relevance (BM25/vector) | — | ✅ | — | — |
| Assign tier membership to candidates | — | — | ✅ | — |
| Within-tier ordering | — | — | ✅ | — |
| Apply memory type weights | — | — | ✅ | — |
| Apply reference boost within Tier 8 | — | — | ✅ | — |
| Detect code relevance | — | — | ✅ | — |
| Validate memory `user_confirmed` | ✅ (count) | — | ✅ (per-candidate) | — |
| Verify attachment `parse_status` | ✅ (count) | — | ✅ (per-candidate) | — |
| Estimate token costs | — | — | ✅ (advisory) | ✅ (authoritative) |
| Apply hard token budget | — | — | — | ✅ |
| Fetch full content from SQLite | — | — | — | ✅ |
| Assemble prompt text | — | — | — | ✅ |
| Write context snapshot | — | — | — | ✅ |
| Produce diagnostics | ✅ | ✅ | ✅ | — |

---

## 16. Privacy Rules Summary

All rules from RETRIEVAL-ARCH-001, SCOPE-RESOLUTION-DESIGN-001, and the signal expansion
review apply without exception. The following are specific to the Context Selection contract:

1. **`text_preview` in `ContextCandidate` must pass the 20-marker forbidden check** before
   being included. Failure sets `text_preview = None`; it does not drop the candidate.

2. **`rank_signals` in `ContextCandidate` are diagnostic only.** They must not appear in
   any assembled prompt section. They are recorded in the context snapshot diagnostics only.

3. **`is_hidden_background = true` is irreversible once set.** No downstream layer may
   clear it.

4. **`ContextSelectionDiagnostics` carries no content.** Source IDs, source text,
   query text, Loom names, and response titles are forbidden in diagnostics.

5. **The memory `memory_type` lookup in §9 must not fetch `content` or
   `normalized_content`.** Only `memory_id` and `memory_type` are read.

6. **The attachment `parse_status` check in §10 must not fetch `content_text`.**
   Only `parse_status` and `attachment_id` are read.

7. **No agent audit data enters `ContextPayload`.** `agent_runs`, `agent_events`, and
   `agent_steps` are never `source_kind` values. Context Selection does not query these
   tables.

8. **Weft origin context is `is_hidden_background = true` structurally**, not optionally.
   If Context Selection emits a Tier 3 candidate, it must have this flag set. There is no
   code path in which a Weft origin candidate is emitted without the flag.

---

## 17. Future Context Manager Boundary Notes

When AGENT-CONTEXT-MANAGER-DESIGN-001 (Phase 3A) is implemented, it should:

1. Accept `ContextPayload` as its sole domain input (plus the current user prompt from the
   orchestrator).
2. Reuse `ContextBudgetPlan` from `context/budget.rs` — the existing implementation is
   already used for non-agent flows and is structurally compatible.
3. Reuse `ContextRetrievalIncludeMode` (already defined in `context/retrieval.rs`) as the
   authoritative mode enum; `ContextIncludeModeHint` is the advisory version that Context
   Selection produces and Context Manager upgrades/downgrades as needed.
4. Reuse `ContextCandidateKind` mapping from `context/types.rs` for budget accounting
   records — the existing `ContextCandidateBudgetRecord` structure is compatible.
5. Extend `ContextBudgetDiagnostics` to include tier-level breakdown (already has
   per-kind accounting; adding per-tier is additive).

The `ContextPayload` struct fields map to existing `BuildContextInput` and
`ContextRetrievalResult` shapes as follows:

| ContextPayload field | Existing equivalent in non-agent CM |
|---|---|
| `policy_entries` | injected system messages |
| `mandatory_references` | `attached_references` |
| `conversation_turns` | `recent_messages` |
| `weft_origin_chain` | `weft_origin` |
| `scoped_memories + global_memories` | `memory_messages` |
| `scoped_retrieval` | `ContextRetrievalResult.selected` |
| `conversation_attachments` | `BuildContextInput` attachment contributions |
| Tiers 9, 10 | new; no existing equivalent |

---

## 18. Rollout Notes

This document defines the contract only. Implementation proceeds as:

1. Define `ContextSourceTier`, `ContextCandidate`, `ContextIncludeModeHint`,
   `PolicyEntry`, `ContextPayload`, `ContextSelectionRequest`, `ContextBudgetHint`,
   `ContextSelectionMode`, `ContextSelectionDiagnostics`, `TierDiagnostic`,
   `TierDiagnosticStatus` as Rust types in `services/loom-service/src/context/` or a
   new `services/loom-service/src/context_selection/` module.

2. Implement `ContextSelectionService.select()` which:
   - Accepts `ContextSelectionRequest`
   - Makes bounded SQLite metadata reads for Tier 2 (conversation thread) and per-
     candidate validation (memory type, attachment parse_status)
   - Assigns tiers to `RetrievalCandidate` entries from all provided `RetrievalResult`s
   - Applies within-tier ordering rules
   - Emits `ContextPayload`

3. Wire into the agent turn orchestration point after `ScopeResolutionService.resolve()`
   and after `HybridRetrievalService.retrieve()` per-tier calls.

No migrations required. All SQLite reads in this contract use existing indexed columns
(`response_id`, `memory_id`, `attachment_id`) as primary-key lookups.
