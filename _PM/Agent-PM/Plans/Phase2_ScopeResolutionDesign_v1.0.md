# Agent Phase 2: Scope Resolution Design v1.0

## Task ID

SCOPE-RESOLUTION-DESIGN-001

## Objective

Design the Scope Resolution layer that sits between the user query and Context Selection.

Retrieval (Hybrid Retrieval Service) answers: "What text is relevant?"
Scope Resolution answers: "Where is it valid to look?"

Without Scope Resolution, neither Hybrid Retrieval nor Context Selection knows which Looms
are in play, which Weft lineage chains are active, which memories are in scope, which
attachments are valid, or which archived sources may be sampled. They receive a shapeless
query and have no structural grounding about the agent turn's context universe.

Scope Resolution produces a `ScopeContext` — a prioritized, typed description of every
source domain available to this agent turn — which both Hybrid Retrieval and Context
Selection consume, each at the layer of their own concern.

This document is **architecture and design only**. No code, no migrations, no repositories,
no runtime changes.

## Status

Design only. Depends on:
- HYBRID-RETRIEVAL-SERVICE-001 (Agent Phase 2E) — complete
- RETRIEVAL-DIAGNOSTICS-001 (Agent Phase 2F) — complete

Implementation is tracked separately as SCOPE-RESOLUTION-001.

## Changelog
- **v1.0**: Initial Scope Resolution architecture design (SCOPE-RESOLUTION-DESIGN-001).

---

## 1. Why Scope Resolution Is a Distinct Layer

### The Gap

`HybridRetrievalService.retrieve()` receives a `RetrievalQuery` containing:
- `query: String` — the scrubbed text
- `mode: RetrievalMode` — Hybrid / KeywordOnly / SemanticOnly
- `max_candidates: usize`
- `source_kinds: Vec<String>` — optional allowlist

It does not receive: which `loom_id`s are in scope, whether the active Loom is a Weft,
which Weft origin chain applies, which memories are scoped vs global, which attachments
are linked, or whether cross-conversation or archived retrieval is permitted.

`ContextSelectionRequest` similarly receives a `loom_id` and `agent_run_id`, but not a
structured answer to "what is in scope and at what priority."

Both layers assume someone else has already resolved the scope universe. Scope Resolution
is that someone.

### What Scope Resolution Does

1. Accepts the active `loom_id` and `agent_run_id` as its primary inputs.
2. Queries SQLite to discover all scope domains: active Loom, Weft lineage chain, project
   group (reserved), memories (scoped + global), attachments (conversation-level), and
   cross-conversation / archived retrieval availability.
3. Produces a `ScopeContext`: a structured, prioritized list of `ScopeDescriptor` values,
   each describing one scope domain with its type, priority, loom coverage, visibility
   flags, and lineage metadata.
4. Passes `ScopeContext` downstream. Hybrid Retrieval uses it as a loom allowlist for
   scoping queries. Context Selection uses it to assign tier membership to candidates.

### What Scope Resolution Does NOT Do

- Does not fetch response content, memory content, or attachment text from SQLite.
- Does not evaluate text relevance. It does not know or care what the query says.
- Does not rank candidates. Scoring is Hybrid Retrieval's job.
- Does not apply token budgets. Token budgeting is Context Manager's job.
- Does not assemble prompts. That is Context Manager's job.
- Does not write to memory. That is a separate policy layer (Phase 4).
- Does not execute tools. That is Phase 5+.

---

## 2. Scope Types

The following scope types are the complete vocabulary for SCOPE-RESOLUTION-001. All are
defined here; reserved types are stubs in the implementation but must be present in the
enum and the `ScopeContext` struct to avoid a breaking redesign when they land.

### 2.1 CurrentConversation

The active Loom and its direct conversation thread.

- Always present. A Scope Resolution request without an active `loom_id` is invalid.
- Covers: `responses` table rows where `loom_id = active_loom_id AND is_deleted = 0`.
- Priority tier: 2 (Conversation Thread) in the Context Selection model.
- Visibility: `Visible`.
- Lineage depth: 0 (the active Loom, not an origin).
- The always-include policy entries (Tier 1) are not a scope — they are a Context Selection
  responsibility. Scope Resolution does not enumerate policy memory or current-turn
  References as scopes; it leaves those to Context Selection's mandatory tier.

### 2.2 WeftOriginChain

The lineage of origin Looms for a Weft Loom, read from `weft_origin_contexts`.

- Present only when `looms.origin_loom_id IS NOT NULL` for the active Loom.
- Empty for non-Weft Looms.
- May be multiple levels deep: origin Loom → origin's origin Loom → ... (capped at
  `MAX_WEFT_LINEAGE_DEPTH = 3`; cycles are detected and broken at discovery time).
- Each level is a separate `ScopeDescriptor` with `lineage_depth = 1, 2, 3`.
- Visibility: `HiddenBackground` for all Weft lineage scopes.
  This flag is set by Scope Resolution and must be carried through to Context Selection's
  `ContextCandidate.is_hidden_background = true`. It must never be rendered as visible
  transcript.
- Priority tier: 3 (Branch Lineage / Weft Origin Chain).
- Source: `weft_origin_contexts` table (`weft_loom_id`, `origin_loom_id`,
  `origin_response_id`), joined to `looms` to verify the origin Loom exists and
  `is_deleted = 0`.

### 2.3 ProjectGroup

Future: a workspace-level scope grouping multiple Looms by project or tab group.

- Not yet implemented. Reserved.
- When implemented: covers all Looms within the same project/tab-group entity (pending
  schema design for project grouping).
- Priority tier: 4 (Project / Tab Group).
- Visibility: `Visible`.
- Status: `Reserved` in the current implementation. Scope Resolution emits a
  `ScopeDescriptor` of type `ProjectGroup` with `status = Reserved` in every
  `ScopeContext` so Context Selection's Tier 4 stub is consistently populated.

### 2.4 ScopedMemory

User-confirmed memories where `source_loom_id = active_loom_id`.

- Covers: `memories` where `source_loom_id = active_loom_id AND user_confirmed = 1
  AND deleted_at IS NULL`.
- Priority tier: 5 (Scoped Memories).
- Visibility: `Visible`.
- Memory type breakdown (used by Context Selection for within-tier ordering):
  - `explicit_user_memory`: weight 1.2
  - `inferred_preference`: weight 1.0 (when `user_confirmed = 1`)
- Scope Resolution enumerates the count and type distribution of eligible memories;
  it does not fetch content.

### 2.5 GlobalMemory

User-confirmed memories where `source_loom_id IS NULL`.

- Covers: `memories` where `source_loom_id IS NULL AND user_confirmed = 1
  AND deleted_at IS NULL`.
- A memory with `source_loom_id IS NULL` is not scoped to any single Loom; it applies
  to every agent turn regardless of which Loom is active.
- Priority tier: 5 (Scoped Memories, lower sub-tier than ScopedMemory). In tier ordering:
  ScopedMemory candidates are tried before GlobalMemory candidates of equal retrieval score.
- Visibility: `Visible`.
- Scope Resolution emits `GlobalMemory` as a separate `ScopeDescriptor` from `ScopedMemory`
  so Context Selection can enforce the within-tier ordering without needing to re-query.

### 2.6 ConversationAttachment

Parsed attachments linked to the active Loom.

- Covers: `attachments` where `loom_id = active_loom_id AND parse_status = 'ready'`.
  Attachments with `parse_status != 'ready'` are excluded at Scope Resolution time, not
  at Context Selection time.
- Priority tier: 6 (Conversation Attachments).
- Visibility: `Visible`.
- Scope Resolution records: attachment count eligible for this scope (not content).
- Implementation note: attachment chunk candidates flow through Hybrid Retrieval
  (`source_kind = "attachment_chunk"`) with `loom_id` scoped to the active Loom via the
  loom allowlist in `ScopeContext`. No separate attachment lookup path is required.

### 2.7 ProjectAttachment

Future: attachments shared at project/tab-group scope.

- Not yet implemented. Reserved.
- Priority tier: 7 (Project / Tab-Group Attachments).
- Status: `Reserved`. Emitted as a stub in every `ScopeContext`.

### 2.8 ScopedRetrieval

Cross-source Hybrid Retrieval scoped to the active Loom (responses, memories, capsules,
checkpoints, code blocks, references from that Loom).

- This is the primary retrieval scope. It is always present.
- The loom allowlist for this scope is `{active_loom_id}`.
- Priority tier: 8 (Hybrid Retrieval Candidates, scoped).
- Visibility: `Visible`.
- Scope Resolution produces the loom allowlist; Hybrid Retrieval does the search.

### 2.9 CrossConversationRetrieval

Hybrid Retrieval over all non-deleted, non-archived Looms excluding the active Loom.

- Covers: `looms` where `is_deleted = 0 AND archived_at IS NULL
  AND loom_id != active_loom_id`.
- Priority tier: 9 (Global Retrieval).
- Visibility: `Visible`.
- Strictly capped: Scope Resolution records the cross-conversation loom count for
  diagnostics. Context Selection enforces a hard candidate cap (suggested N = 5) after
  retrieval; Scope Resolution does not enforce this cap itself.
- The loom allowlist for this scope is the full set of eligible cross-conversation
  `loom_id`s. Hybrid Retrieval uses this list to scope its query.

### 2.10 ArchivedRetrieval

Hybrid Retrieval over archived Looms (where `looms.archived_at IS NOT NULL`).

- Covers: `looms` where `archived_at IS NOT NULL AND is_deleted = 0`.
- Priority tier: 10 (Archived Retrieval).
- Visibility: `Visible`.
- Lowest categorical priority. Strictly capped with a lower cap than
  `CrossConversationRetrieval` (suggested N = 3). Cap enforced at Context Selection time.
- The loom allowlist for this scope is the set of archived `loom_id`s.

### 2.11 ToolMcpContext

Future: context contributed by tool calls or MCP tool execution.

- Not yet implemented. Reserved.
- Priority tier: 11 (Tool / MCP-Derived Context).
- Status: `Reserved`. Emitted as a stub in every `ScopeContext`.
- Raw tool output never enters context. Only sanitized summaries from tool execution
  are eligible here, and only after tool runtime integration (Phase 5+).

---

## 3. ScopeDescriptor Contract

`ScopeDescriptor` is the canonical unit of output from Scope Resolution. Each scope type
produces exactly one `ScopeDescriptor` per `ScopeContext` (some may be empty stubs).

```
ScopeDescriptor {
    // Identity
    scope_type: ScopeType,           // enum: see §2
    priority:   u8,                  // 1–11, matching Context Selection tier model

    // Status
    status: ScopeStatus,             // Active | HiddenBackground | Empty | Reserved | Unavailable

    // Coverage (no content; identity references only)
    loom_ids:          Vec<String>,  // Loom IDs covered by this scope
    memory_scope:      Option<MemoryScopeInfo>,
    attachment_scope:  Option<AttachmentScopeInfo>,

    // Visibility
    visibility: ScopeVisibility,     // Visible | HiddenBackground

    // Lineage (Weft-specific)
    lineage_depth:     Option<u8>,   // 0 = active Loom, 1 = immediate origin, 2+...
    origin_loom_id:    Option<String>,
    origin_response_id: Option<String>,

    // References
    explicit_reference_ids: Vec<String>,  // current-turn Reference IDs in scope
    // Empty for all scopes except explicit reference-carrying scopes (see §5)
}

MemoryScopeInfo {
    eligible_count:              usize,
    explicit_user_memory_count:  usize,
    inferred_confirmed_count:    usize,
}

AttachmentScopeInfo {
    eligible_attachment_count: usize,  // parse_status = 'ready' only
}

enum ScopeType {
    CurrentConversation,
    WeftOriginChain,
    ProjectGroup,          // Reserved
    ScopedMemory,
    GlobalMemory,
    ConversationAttachment,
    ProjectAttachment,     // Reserved
    ScopedRetrieval,
    CrossConversationRetrieval,
    ArchivedRetrieval,
    ToolMcpContext,        // Reserved
}

enum ScopeStatus {
    Active,           // Scope is populated and eligible for this turn
    HiddenBackground, // Active but must never render as visible transcript
    Empty,            // Scope exists but has no eligible content (e.g. no attachments)
    Reserved,         // Scope type is defined but not yet implemented
    Unavailable,      // Scope was expected but could not be resolved (e.g. SQLite error)
}

enum ScopeVisibility {
    Visible,           // Content may appear in visible conversation or background context
    HiddenBackground,  // Content is injected as hidden background; never rendered as transcript
}
```

### ScopeContext (the full output of Scope Resolution)

```
ScopeContext {
    // All scopes for this turn, in priority order (priority 1 → 11)
    scopes: Vec<ScopeDescriptor>,

    // Active Loom identity
    active_loom_id: String,
    agent_run_id:   String,

    // Weft detection
    weft_loom_detected: bool,

    // Loom allowlist per retrieval tier (for HybridRetrievalService)
    scoped_retrieval_loom_ids:        Vec<String>,  // Tier 8: {active_loom_id}
    cross_conversation_loom_ids:      Vec<String>,  // Tier 9: all non-archived, non-deleted
    archived_retrieval_loom_ids:      Vec<String>,  // Tier 10: archived only

    // Diagnostics (no content; see §9)
    diagnostics: ScopeResolutionDiagnostics,
}
```

---

## 4. Scope Discovery

Scope Resolution performs all discovery from SQLite in a single logical transaction
(or a fast sequential set of indexed reads). It does not call Hybrid Retrieval, Context
Selection, or any external service during discovery.

### 4.1 Discovery Steps (in order)

**Step 1 — Active Loom resolution**

Query: `SELECT loom_id, origin_loom_id, origin_response_id, is_deleted, archived_at
        FROM looms WHERE loom_id = ?`

- If the Loom does not exist or `is_deleted = 1`: return a `ScopeContext` with a single
  `ScopeDescriptor { scope_type: CurrentConversation, status: Unavailable }` and a
  diagnostic error. Do not proceed.
- If the Loom exists and `is_deleted = 0`: emit `CurrentConversation` scope with
  `loom_ids = [active_loom_id]`, `status = Active`, `visibility = Visible`.
- Weft detection: if `origin_loom_id IS NOT NULL`, set `weft_loom_detected = true` and
  proceed to Step 2. Otherwise Step 2 produces an empty WeftOriginChain.

**Step 2 — Weft lineage chain resolution**

Only runs when `weft_loom_detected = true`.

Query: `SELECT origin_loom_id, origin_response_id FROM weft_origin_contexts
        WHERE weft_loom_id = ?`

Walk the origin chain:
1. Load `weft_origin_contexts` for the active Loom → depth 1 origin.
2. Load `looms` for `origin_loom_id` to verify it exists and `is_deleted = 0`.
3. If valid: emit `WeftOriginChain` scope with `lineage_depth = 1`,
   `origin_loom_id`, `origin_response_id`, `visibility = HiddenBackground`,
   `status = HiddenBackground`.
4. Recursively: if the origin Loom itself has an `origin_loom_id`, repeat up to
   `MAX_WEFT_LINEAGE_DEPTH = 3` levels.
5. Cycle detection: maintain a `visited_loom_ids: HashSet<String>` during traversal.
   If a `loom_id` is encountered that is already in the visited set, stop traversal
   and emit a `diagnostics.weft_cycle_detected = true` flag (non-fatal; best-effort
   truncation).

Each WeftOriginChain level is a separate `ScopeDescriptor`. All carry
`visibility = HiddenBackground`.

**Step 3 — Memory scope resolution**

Two queries, run in parallel:

Scoped memories:
```
SELECT COUNT(*), memory_type FROM memories
WHERE source_loom_id = ? AND user_confirmed = 1 AND deleted_at IS NULL
GROUP BY memory_type
```

Global memories:
```
SELECT COUNT(*), memory_type FROM memories
WHERE source_loom_id IS NULL AND user_confirmed = 1 AND deleted_at IS NULL
GROUP BY memory_type
```

- Emit `ScopedMemory` scope with `MemoryScopeInfo` counts (not content).
- Emit `GlobalMemory` scope with `MemoryScopeInfo` counts (not content).
- If either count is 0: emit the scope with `status = Empty`, not `Reserved`.

**Step 4 — Attachment scope resolution**

Query:
```
SELECT COUNT(*) FROM attachments
WHERE loom_id = ? AND parse_status = 'ready'
```

- Emit `ConversationAttachment` scope with `AttachmentScopeInfo { eligible_attachment_count }`.
- If count = 0: `status = Empty`.
- `ProjectAttachment` is always emitted as `status = Reserved`.

**Step 5 — Cross-conversation loom resolution**

Query:
```
SELECT loom_id FROM looms
WHERE is_deleted = 0 AND archived_at IS NULL AND loom_id != ?
```

- Collect all eligible `loom_id`s into `cross_conversation_loom_ids`.
- Emit `CrossConversationRetrieval` scope. If no other Looms exist: `status = Empty`.

**Step 6 — Archived loom resolution**

Query:
```
SELECT loom_id FROM looms
WHERE archived_at IS NOT NULL AND is_deleted = 0
```

- Collect into `archived_retrieval_loom_ids`.
- Emit `ArchivedRetrieval` scope. If none: `status = Empty`.

**Step 7 — Reserved scopes (always emitted)**

Always emit, in order:
- `ProjectGroup`: `status = Reserved`
- `ProjectAttachment`: `status = Reserved`
- `ToolMcpContext`: `status = Reserved`

These stubs ensure `ScopeContext.scopes` always has all 11 scope types present,
so Context Selection never needs to handle "scope type absent" as a special case.

**Step 8 — Emit ScopeContext**

Assemble the complete `ScopeContext` with:
- `scopes` sorted by `priority ASC` (1 → 11)
- `scoped_retrieval_loom_ids = [active_loom_id]`
- `cross_conversation_loom_ids` from Step 5
- `archived_retrieval_loom_ids` from Step 6
- `diagnostics` populated (see §9)

---

## 5. Explicit References

Explicit References are user-selected content anchors created when the user attaches a
Reference chip to the current turn's composer input. They are structurally different from
retrieval-scored reference candidates:

- **Current-turn explicit References**: anchors the user actively attached to this prompt.
  They are mandatory context (Tier 1) regardless of retrieval score.
- **Historical References**: References from earlier turns in the conversation, stored in
  the `references` table with `source_loom_id = active_loom_id`. They participate in
  Hybrid Retrieval as `source_kind = "reference"` candidates (Tier 8) with
  `reference_weight = 1.5` within-tier multiplier applied by Context Selection.
- **Retrieval-discovered References**: References surfaced by Hybrid Retrieval as scored
  candidates from across the projection. They belong to Tiers 8–10 depending on their
  originating Loom scope.

### Reference Scope in Scope Resolution

Scope Resolution handles current-turn explicit References as a scope annotation, not a
tier. The caller (orchestration layer, not Scope Resolution itself) provides
`explicit_reference_ids: Vec<String>` in the `ScopeResolutionRequest`. Scope Resolution:

1. Validates that each `reference_id` exists in the `references` table.
2. Records valid `reference_id`s in the `CurrentConversation` scope descriptor's
   `explicit_reference_ids` field.
3. Does not fetch reference content (that is Context Manager's job).
4. Does not elevate or score them (that is Context Selection's job — Tier 1 elevation
   for current-turn References).

**How this flows:**
- Scope Resolution annotates `CurrentConversation.explicit_reference_ids`.
- Context Selection reads these and elevates them to Tier 1 (mandatory).
- Context Manager resolves the full content of each reference by `reference_id`.

### Reference Scope and Cross-Loom References

A Reference may point to content in a different Loom than the active Loom
(`references.source_loom_id` may differ from `active_loom_id`, or the referenced
`target_id` may be from another Loom). Scope Resolution does not expand the loom allowlist
solely because a Reference points cross-Loom. Cross-Loom References are resolved by
Context Manager fetching their target content from SQLite directly — they do not
require `CrossConversationRetrieval` scope to be active.

---

## 6. Memory Scope

Memory eligibility is determined entirely by the `memories` table at Scope Resolution
time. No memory content is fetched by Scope Resolution — only counts and type
distributions.

### Eligibility Rules (invariants enforced at Scope Resolution time)

| Condition | Action |
|---|---|
| `user_confirmed = 0` | Not eligible for any memory scope |
| `deleted_at IS NOT NULL` | Not eligible |
| `source_loom_id = active_loom_id AND user_confirmed = 1` | Eligible for `ScopedMemory` |
| `source_loom_id IS NULL AND user_confirmed = 1` | Eligible for `GlobalMemory` |
| `source_loom_id = other_loom_id` | Not eligible in this turn's scope (cross-conversation memory is not a supported scope in v1.0) |

### Memory Type Weights (advisory; enforced at Context Selection time)

Scope Resolution records the `memory_type` distribution in `MemoryScopeInfo` so Context
Selection can apply `retrieval_score × memory_type_weight` ordering within Tier 5 without
re-querying:
- `explicit_user_memory`: weight = 1.2
- `inferred_preference` (when `user_confirmed = 1`): weight = 1.0

### Memory Scope vs. Memory Policy Engine (Phase 4)

Scope Resolution's memory scoping is purely eligibility-based:
- It answers: "which memories are confirmed and in scope?"
- It does NOT apply confidence thresholds, decay functions, topic relevance filters, or
  memory recency policies.
- The future Memory Policy Engine (Phase 4) will sit between Scope Resolution and Context
  Selection as a filter that may further narrow the eligible memory set or reweight
  `retrieval_score` for memory candidates. Its introduction requires no change to Scope
  Resolution's contract — it consumes `ScopeContext.scopes[ScopedMemory/GlobalMemory]`
  and produces a filtered memory scope annotation before Context Selection runs.

---

## 7. Attachments

### Attachment Eligibility at Scope Resolution Time

Scope Resolution checks `parse_status = 'ready'` for all attachments linked to the active
Loom. Attachment content never passes through Scope Resolution.

Attachment chunks flow through Hybrid Retrieval as `source_kind = "attachment_chunk"` with
`loom_id` scoped to `active_loom_id` via the `ScopeContext.scoped_retrieval_loom_ids`
allowlist. No separate attachment lookup path is needed in Context Selection — attachment
chunks appear as retrieval candidates in Tier 6 (ConversationAttachment) when their
`loom_id` matches the active Loom's scope.

### Attachment Scope Assignment (how Context Selection knows which tier)

A `RetrievalCandidate` with `source_kind = "attachment_chunk"` and
`loom_id = active_loom_id` → Tier 6 (ConversationAttachment).
A `RetrievalCandidate` with `source_kind = "attachment_chunk"` and
`loom_id != active_loom_id` (from cross-conversation scope) → Tier 9 or 10 depending on
whether the originating Loom is active or archived.

Scope Resolution makes this mapping possible by providing the loom allowlists per
retrieval tier in `ScopeContext`.

### Project Attachment (Reserved)

`ProjectAttachment` scope (Tier 7) is reserved. When implemented, it will cover:
- Attachments whose `loom_id` belongs to a project-group entity that is in scope.
- Priority is strictly lower than `ConversationAttachment` regardless of retrieval score.
- Implementation will require a schema addition for project/group membership (not
  yet designed) and an additional Scope Resolution discovery step.

---

## 8. Retrieval Boundaries

The four layers have strictly non-overlapping responsibilities:

### Scope Resolution

**Answers:** "What is the valid search and context universe for this agent turn?"

**Inputs:**
- `active_loom_id: String`
- `agent_run_id: String`
- `explicit_reference_ids: Vec<String>` (current-turn composer references, from caller)

**Outputs:**
- `ScopeContext` — prioritized scope descriptors + loom allowlists + diagnostics

**Reads from SQLite:** `looms`, `weft_origin_contexts`, `memories` (counts only),
`attachments` (counts only), `references` (existence check for explicit refs only).

**Never:**
- Evaluates text relevance
- Calls Hybrid Retrieval Service
- Fetches response, memory, or attachment content
- Applies token budgets
- Makes tier inclusion decisions

---

### Hybrid Retrieval Service

**Answers:** "Which indexed content is relevant to this query, within the loom scope
provided?"

**Inputs:**
- `RetrievalQuery` (unchanged contract)
- `loom_allowlist: Vec<String>` — from `ScopeContext` (new addition to `RetrievalQuery`)

**Outputs:**
- `RetrievalResult` with ranked `RetrievalCandidate` list

**Change required for SCOPE-RESOLUTION-001:**
`RetrievalQuery` must be extended with a `loom_ids: Vec<String>` field (optional;
empty = no loom filter, search all). The Tantivy and LanceDB adapters must filter on
`loom_id` when this field is non-empty. This is the single concrete structural change
that Scope Resolution integration requires in Hybrid Retrieval.

**Never:**
- Decides which scope types exist
- Knows about Weft lineage or visibility
- Knows about tier priorities
- Knows about token budgets

---

### Context Selection

**Answers:** "Which candidates from all scopes should be included, in what tier order?"

**Inputs:**
- `ScopeContext` from Scope Resolution
- `RetrievalResult` from Hybrid Retrieval Service (per-tier)
- `ContextSelectionRequest` (loom_id, agent_run_id, budget_hint, mode)

**How it uses ScopeContext:**
- Reads `weft_loom_detected` to decide whether WeftOriginChain scope is populated.
- Reads `scopes[WeftOriginChain].visibility = HiddenBackground` and sets
  `ContextCandidate.is_hidden_background = true` for all Weft lineage content.
- Reads `scopes[ScopedMemory/GlobalMemory].memory_scope.eligible_count` to decide
  whether to issue a memory retrieval query.
- Reads `scopes[ConversationAttachment].attachment_scope.eligible_attachment_count`
  to decide whether attachment candidates are expected in the retrieval result.
- Uses loom allowlists to call Hybrid Retrieval per tier:
  - Tier 8: `ScopeContext.scoped_retrieval_loom_ids`
  - Tier 9: `ScopeContext.cross_conversation_loom_ids`
  - Tier 10: `ScopeContext.archived_retrieval_loom_ids`
- Assigns tier membership to each `RetrievalCandidate` by matching its `loom_id` against
  the per-tier allowlists in `ScopeContext`.

**Never:**
- Re-discovers scope (Scope Resolution already did this)
- Fetches full content from SQLite
- Applies hard token budgets

---

### Context Manager

**Answers:** "How does the selected payload fit in the token budget and what does the
prompt look like?"

**Inputs:**
- `ContextPayload` from Context Selection (already tier-ordered, with
  `is_hidden_background` flags set)

**Never:**
- Calls Hybrid Retrieval
- Makes scope decisions
- Makes tier membership decisions

---

## 9. Diagnostics

`ScopeResolutionDiagnostics` follows the same privacy bar as `RetrievalDiagnostics` and
`agent_events`: counts, types, and latency only. No content, no source IDs, no query text,
no Loom names, no memory content.

```
ScopeResolutionDiagnostics {
    // Per-scope status
    scopes: Vec<ScopeDiagnostic>,

    // Aggregate
    total_scopes_discovered: usize,
    total_active_scopes:     usize,  // status = Active or HiddenBackground
    total_empty_scopes:      usize,  // status = Empty
    total_reserved_scopes:   usize,  // status = Reserved

    // Weft
    weft_loom_detected:    bool,
    weft_lineage_depth:    u8,       // 0 if not a Weft Loom
    weft_cycle_detected:   bool,

    // Cross-conversation
    cross_conversation_loom_count: usize,
    archived_loom_count:           usize,

    // Explicit references
    explicit_references_provided:  usize,  // from request
    explicit_references_validated: usize,  // found in references table

    // Latency
    discovery_latency_ms: u64,
}

ScopeDiagnostic {
    scope_type:   ScopeType,
    priority:     u8,
    status:       ScopeStatus,
    loom_count:   usize,         // number of loom_ids in this scope (NOT the loom IDs themselves)
    memory_count: usize,         // 0 for non-memory scopes
    attachment_count: usize,     // 0 for non-attachment scopes
    lineage_depth:    Option<u8>, // for WeftOriginChain scopes
}
```

### Privacy Invariants for Diagnostics

Must NOT appear in `ScopeResolutionDiagnostics`:
- Loom IDs or names
- Response IDs or titles
- Memory content or labels
- Attachment names or content
- Query text
- `explicit_reference_ids` values (only counts)
- `weft_origin_loom_id` values (only depth)

Must be safe for the existing diagnostics inspector surface without a separate review.

---

## 10. ScopeResolutionRequest / API Shape

```
ScopeResolutionRequest {
    active_loom_id:        String,
    agent_run_id:          String,
    explicit_reference_ids: Vec<String>,  // current-turn composer references; may be empty
    options:               ScopeResolutionOptions,
}

ScopeResolutionOptions {
    include_archived:            bool,    // default: false
    max_weft_lineage_depth:      u8,      // default: 3, max: 3
    cross_conversation_enabled:  bool,    // default: true
}
```

`ScopeResolutionService` has one public method:

```
fn resolve(request: ScopeResolutionRequest) -> ScopeContext
```

It is synchronous relative to its caller. All SQLite reads in §4 are fast indexed queries
on primary keys or indexed foreign keys; no full-table scans are performed during scope
discovery.

---

## 11. Pipeline Integration

The Scope Resolution layer integrates at the agent turn orchestration point, before
Hybrid Retrieval and Context Selection are called:

```
AgentTurnOrchestrator
    │
    ├─ 1. Receive: active_loom_id, agent_run_id, explicit_reference_ids, user_query
    │
    ├─ 2. ScopeResolutionService.resolve(...)
    │       └─ returns: ScopeContext (loom allowlists + scope descriptors + diagnostics)
    │
    ├─ 3. HybridRetrievalService.retrieve(RetrievalQuery { loom_ids: scoped_retrieval_loom_ids })
    │       └─ returns: RetrievalResult for Tier 8 (scoped)
    │
    ├─ 4. [Optional, budget-controlled]
    │   HybridRetrievalService.retrieve(RetrievalQuery { loom_ids: cross_conversation_loom_ids })
    │       └─ returns: RetrievalResult for Tier 9 (cross-conversation)
    │
    ├─ 5. [Optional, budget-controlled]
    │   HybridRetrievalService.retrieve(RetrievalQuery { loom_ids: archived_retrieval_loom_ids })
    │       └─ returns: RetrievalResult for Tier 10 (archived)
    │
    ├─ 6. ContextSelectionService.select(scope_context, retrieval_results, request)
    │       └─ returns: ContextPayload (tier-ordered, with is_hidden_background flags)
    │
    └─ 7. AgentContextManager.assemble(context_payload)
            └─ returns: prompt assembly for provider dispatch
```

Note that Steps 3–5 may be issued in parallel where budget guidance permits. Step 4 and 5
are conditional: if the `ContextBudgetHint` from the orchestrator indicates available
budget after Tiers 1–8, Cross-Conversation (Tier 9) is issued; if budget remains after
that, Archived (Tier 10) is issued. Scope Resolution does not make this decision — it
provides the loom allowlists and reports scope availability; the orchestrator decides
whether to issue the optional retrieval queries.

---

## 12. Future Compatibility

### Memory Policy Engine (Phase 4)

Scope Resolution's `ScopedMemory` and `GlobalMemory` scopes represent eligibility only.
When Phase 4 introduces a Memory Policy Engine, it will:
- Receive `ScopeContext.scopes[ScopedMemory/GlobalMemory]`
- Apply confidence thresholds, topic relevance, and decay functions
- Return a filtered/reweighted memory scope annotation

No change to `ScopeResolutionRequest`, `ScopeDescriptor`, or `ScopeContext` is required.
The Memory Policy Engine is an additional post-processing step, not a redesign.

### Tool Runtime and MCP (Phase 5+)

`ToolMcpContext` (Tier 11) is reserved as a stub in `ScopeContext`. When tool/MCP
integration lands, Scope Resolution will be extended to:
- Accept tool execution results from the agent orchestrator
- Emit a `ToolMcpContext` scope descriptor with sanitized artifact references (not raw
  tool output)

No existing scope types or contracts require modification.

### Multi-Agent (future)

In a multi-agent scenario, an agent's `active_loom_id` may be the output of another
agent's run. Scope Resolution is structurally compatible: each agent turn has its own
`ScopeResolutionRequest` with its own `active_loom_id`. No cross-agent scope sharing
is implied by the current design, and the reserved stubs provide natural extension points
when a project-level scope shared across multiple agent instances is needed.

### Future Graph Retrieval

The Retrieval Architecture (Phase 2A) noted that `context_graph_links` and the graph
traversal logic in `context/retrieval.rs` are structural/graph candidates rather than
text-relevance candidates. When graph retrieval is formalized, Scope Resolution is the
natural provider of the graph traversal scope (which `loom_id`s, which relationship kinds,
which depth limit). The `ScopeType` enum has an extension point for this; no enum value
is reserved today but the pattern is identical to `CrossConversationRetrieval`.

### Project / Tab-Group (Phase 4+)

`ProjectGroup` (Tier 4) and `ProjectAttachment` (Tier 7) are reserved stubs. Their
implementation will require:
1. A schema addition for project/tab-group membership (new table, not designed here).
2. A Scope Resolution discovery step (Step 3.5 in §4, added between existing steps).
3. A loom allowlist field `ScopeContext.project_loom_ids` for the group scope.

The `ScopeDescriptor` and `ScopeContext` structs are forward-compatible with this addition.

---

## 13. Responsibilities Matrix

| Layer | Knows about scopes? | Knows about text relevance? | Knows about token budgets? | Knows about Weft visibility? | Fetches full content? |
|---|:---:|:---:|:---:|:---:|:---:|
| **Scope Resolution** | Yes — produces them | No | No | Yes — sets flag | No |
| **Hybrid Retrieval** | Consumes loom allowlist only | Yes — ranks candidates | No | No | No |
| **Context Selection** | Consumes ScopeContext | Consumes RetrievalResult | Budget hint only | Reads flag from ScopeContext | No |
| **Context Manager** | No — receives ContextPayload | No | Yes — applies hard budget | Reads flag from ContextPayload | Yes |

---

## 14. Scope Hierarchy (Priority Order)

```
Priority  Scope Type                    Status         Visibility
────────  ─────────────────────────────────────────────────────────
1         [Policy / Always-Include]     (not a scope;  —
                                         Context Selection Tier 1)
2         CurrentConversation           Always Active  Visible
3         WeftOriginChain (per level)   Weft only      HiddenBackground
4         ProjectGroup                  Reserved       Visible
5a        ScopedMemory                  Active/Empty   Visible
5b        GlobalMemory                  Active/Empty   Visible
6         ConversationAttachment        Active/Empty   Visible
7         ProjectAttachment             Reserved       Visible
8         ScopedRetrieval               Always Active  Visible
9         CrossConversationRetrieval    Active/Empty   Visible
10        ArchivedRetrieval             Active/Empty   Visible
11        ToolMcpContext                Reserved       Visible
```

Note: Tier 1 (Policy / Always-Include) is not a scope type. It is a Context Selection
mandatory tier populated from policy memory entries and current-turn explicit References,
both annotated by Scope Resolution into `CurrentConversation.explicit_reference_ids` and
passed through `ScopeContext`. Scope Resolution does not enumerate policy entries itself.

---

## 15. Privacy Invariants

All privacy rules from the Retrieval Architecture (RETRIEVAL-ARCH-001) apply to Scope
Resolution:

1. **Raw thinking must never enter `ScopeContext`.** Scope Resolution reads only `loom_id`,
   `memory_type`, and `parse_status` fields — structural metadata, not content. No path
   through which thinking could enter is introduced.

2. **Weft origin context is always `HiddenBackground`.** `ScopeDescriptor.visibility =
   HiddenBackground` is set by Scope Resolution and must not be overridden downstream.
   Context Selection propagates this flag as `is_hidden_background = true` on every Weft
   lineage `ContextCandidate`.

3. **Agent audit trail is not a scope.** `agent_runs`, `agent_events`, `agent_steps` are
   never included in scope discovery. They have no `ScopeType` and no path into the
   `ScopeContext`. This is structural (no query touches those tables) not just policy.

4. **Diagnostics carry no content.** `ScopeResolutionDiagnostics` contains counts, types,
   latency, and boolean flags only. No `loom_id` values, no Loom names, no response
   titles, no memory labels, no attachment names.

5. **Explicit reference validation is existence-check only.** Scope Resolution verifies
   `reference_id` existence in the `references` table — it does not fetch `selected_text`,
   `label`, `target_id`, or `metadata_json` for any Reference during discovery.

6. **Unconfirmed memories are never in scope.** The `user_confirmed = 1` filter is
   applied at SQL time in Scope Resolution, not left for Context Selection to enforce.
   This makes the eligibility invariant structural at the scope discovery layer.

---

## 16. Rollout Notes

This document defines the architecture only. Implementation is tracked as
SCOPE-RESOLUTION-001 (Agent Phase 2, new sub-phase).

**Implementation dependency order:**
1. `ScopeDescriptor` and `ScopeContext` types (no external dependencies)
2. `ScopeResolutionService.resolve()` — reads from `looms`, `weft_origin_contexts`,
   `memories`, `attachments`, `references` (all existing tables, no migrations needed)
3. `RetrievalQuery.loom_ids: Vec<String>` extension — one field addition to the existing
   struct; requires corresponding filter logic in Tantivy and LanceDB adapters
4. `ScopeResolutionDiagnostics` — follows existing diagnostics privacy patterns
5. Orchestrator wiring — integrates `ScopeResolutionService` before `ContextSelectionService`

**No migrations required.** Scope Resolution reads from existing SQLite tables using
existing indexed columns (`loom_id`, `origin_loom_id`, `user_confirmed`, `deleted_at`,
`archived_at`, `parse_status`). No new tables, no schema changes, no new indexes.

**The only code contract change** to an existing public type is the addition of
`loom_ids: Vec<String>` to `RetrievalQuery`. This is additive (empty = no filter,
preserving existing behavior) and backward-compatible.
