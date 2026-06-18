# Agent Phase 3: Context Manager Design v1.0

## 1. Architecture Overview

The Agent Context Manager is the decisive component in the Loom context pipeline. Sitting between Context Selection and Provider Prompt Assembly, it takes a prioritized list of `ContextCandidate`s (the `ContextPayload`), fetches the canonical full content from SQLite, applies the token budget, decides the inclusion mode for each item, updates the Context Snapshot with final decisions, and assembles the context sections for the provider prompt.

## 2. Responsibility Boundary

To maintain clear separation of concerns, the Context Manager's responsibilities are strictly bounded:

### What Context Manager Owns:
- **Token Budgeting**: Allocates token budgets across context tiers.
- **Content Resolution**: Fetches actual content from SQLite based on candidate identity.
- **Inclusion Decisions**: Decides whether a candidate is fully included, summarized, truncated, or dropped based on the budget.
- **Section Assembly**: Groups resolved context into logical prompt sections.
- **Snapshot Updating**: Enriches the Context Snapshot with final budgeting outcomes and diagnostics.

### What Context Manager Does NOT Own:
- **Scope Resolution**: Traversal of the graph to find available context boundaries.
- **Retrieval**: Querying Tantivy/LanceDB or calculating relevance scores.
- **Context Selection**: Prioritizing candidates or deciding initial tiers.
- **Provider Prompt Assembly**: Translating the structured prompt sections into provider-specific (e.g., OpenAI, Ollama) JSON payloads.

## 3. Input / Output Contracts

### Inputs
- **ContextPayload**: The ordered, tiered list of `ContextCandidate`s from Context Selection.
- **Token Budget**: The total allowed token limit and reserve ratios for the current run, derived from the provider/model profile.
- **Agent Run/Context Snapshot IDs**: Identifiers to link telemetry and auditing.
- **Diagnostics**: `ScopeResolutionDiagnostics`, `RetrievalDiagnostics`, and `ContextSelectionDiagnostics`.
- **Active Context**: `loom_id` and `response_id` / `parent_response_id`.

### Outputs
- **ResolvedPromptContext**: The structured, sectioned context ready for Provider Prompt Assembly.
- **ContextBudgetSnapshot**: Telemetry describing tokens consumed, dropped candidates, and budget math.
- **Updated Context Snapshot**: Finalized `inclusion_status` for all candidates written back to SQLite.

## 4. Content Resolution Model

Context Manager iterates through the `ContextPayload` and resolves full content from SQLite by `(source_kind, source_id, chunk_ref)`.

Resolution behavior by source kind:
- **`response`**: Fetches canonical markdown from `responses`. Applies raw-thinking rejection natively.
- **`memory`**: Fetches confirmed user memory from the `memories` table. Unconfirmed memory is skipped.
- **`attachment_chunk`**: Fetches parsed text chunks from `attachment_chunks`. Skips if missing or failed to parse.
- **`reference`**: Fetches the targeted entity (e.g., response, external link) ensuring explicit focus.
- **`response_capsule`**: Fetches condensed capsule text from `response_capsules`.
- **`checkpoint`**: Fetches rolling summaries from `loom_checkpoints`.
- **`weft_origin_context`**: Fetches origin context but enforces the hidden background rule (will not render as visible transcript).
- **`tool_artifact` (future)**: Fetches verified outputs from tool runs, skipping raw/unverified telemetry.

## 5. Include Mode Model

Candidates are assigned an inclusion mode to maximize signal within the token budget:

- **`Full`**: The entire source text is included. Used for the current active thread, mandatory policy, and explicit references.
- **`Summary`**: A summarized version (e.g., capsule) is used. Applied to older responses or lower-priority retrieval candidates when budget is tight.
- **`ReferenceOnly`**: Only the metadata (e.g., title, ID) is included to inform the model that the concept exists without full text.
- **`Capsule`**: Direct usage of a pre-computed response capsule.
- **`HiddenBackground`**: Included in the prompt for model grounding but excluded from the visible user transcript (e.g., Weft origins).
- **`CodeExact`**: The exact fenced code block text is fetched directly from `response_code_blocks`.
- **`CodeSummary`**: Only the function signature or high-level description is included.
- **`MetadataOnly`**: Used for diagnostic tracing or tags without body text.

## 6. Token Budget Model

The Token Budget allocates capacity across tiers safely.

### Structure
- **Hard Budget**: Absolute max tokens allowed by the model/provider minus output reserve.
- **System Reserved Budget**: Reserved for system prompts and active generation instructions.
- **Core Reserved Budget**: Reserved for the active conversation thread and explicit references.
- **Flexible Budget**: Remaining tokens allocated to attachments, retrieved memories, and background context.

### Overflow Behavior
- **Tier 1 (Mandatory / Core) Exceeds Budget**: The system throws a `TokenOverflowError`. Mandatory context is never silently dropped.
- **Current Conversation Exceeds Budget**: The oldest turns are downgraded to `Capsule` or `Summary` mode until they fit.
- **Attachments Exceed Budget**: Truncated or downgraded to `Summary` / `ReferenceOnly`.
- **Retrieved Memory Exceeds Budget**: Lower-scoring candidates are dropped entirely. The drop is explicitly recorded in the snapshot as `dropped_budget`.

## 7. Prompt Section Model

The Context Manager organizes the resolved text into structured sections. (No raw prompt strings are generated here, only logical blocks).

- **`Section::SystemPolicy`**: Core rules, formatting constraints, and safety instructions.
- **`Section::HiddenBackground`**: Weft origin context and other background knowledge not visible in the UI.
- **`Section::RetrievedKnowledge`**: Scoped memories, retrieved chunks, and attachments (budget permitting).
- **`Section::ExplicitReferences`**: User-selected fragments and explicitly linked context.
- **`Section::ConversationHistory`**: The recent transcript, ending with the immediate user prompt.

## 8. Snapshot Interaction Model

The Context Snapshot acts as the audit log.

- **Read**: Context Manager reads the `ContextPayload` metadata already planned by Context Selection.
- **Write/Update**: For every candidate, Context Manager updates the `inclusion_status` (`included`, `dropped_budget`, `dropped_policy`, `error`).
- **Telemetry**: Writes the `ContextBudgetSnapshot` (token counts, rejection reasons) into the parent `context_snapshots` JSON blob.
- **Foreign Key**: `agent_runs.context_snapshot_id` ensures the run is forever linked to this exact resolution outcome.

## 9. Replay / Explainability Model

The Agent Run Inspector will use the Snapshot to explain the run without storing duplicate content.

- **Which context was used**: Inspector queries `context_snapshot_candidates` where `inclusion_status = 'included'`.
- **Why it was used**: Driven by the `tier` and `retrieval_score` columns in the snapshot.
- **What was dropped**: Queries candidates with `inclusion_status = 'dropped_budget'`.
- **Budget decisions**: Reads the `budget_json` from the `context_snapshots` root row.
- **Hidden background**: Identified by the `is_hidden_background = true` flag.

## 10. Privacy / Safety Model

- **Raw Thinking**: Rejected at the SQLite read boundary. The Context Manager structurally cannot load raw thinking fields into memory.
- **Secrets/Credentials**: Automatically scrubbed. Service config and secrets do not exist in the candidate lookup tables.
- **Provider Payloads**: Never flow into Context Manager.
- **Raw Tool Output**: Deferred to Phase 5, but will require explicit verification before context inclusion.
- **Unconfirmed Memory / Failed Parses**: Soft-deleted or unconfirmed rows resolve to `None` and are marked `error` in the snapshot.

## 11. Failure Mode Model

- **Source Record Missing**: SQLite lookup returns empty. Candidate marked `error: not_found`. Continues to next.
- **Candidate Stale**: Version mismatch between projection and SQLite. Marked `error: stale`. Continues.
- **Deleted Response**: SQLite lookup fails. Marked `error: deleted`. Continues.
- **Token Budget Overflow**: Drops optional tiers. If Tier 1 overflows, aborts the Agent Run with a `TokenOverflowError`.
- **Snapshot Missing**: Context Manager logs a severe warning but proceeds with transient budgeting.
- **SQLite Read Error**: Bubbles up the error, failing the run safely without generating a hallucinated response.

## 12. Future Compatibility

- **Memory Policy Engine**: Dynamic overrides can be injected during Context Selection, and the Context Manager will respect the resulting `is_mandatory` flags.
- **Tool/MCP Artifacts**: A new `source_kind = tool_artifact` seamlessly fits the content resolution model.
- **Agent Behavior**: Multi-agent setups will generate isolated snapshots per sub-agent, preventing cross-contamination.
- **Reranking**: Future cross-encoder reranking occurs in Context Selection; Context Manager blindly trusts the finalized `ContextPayload` ordering.

## 13. Implementation Rollout Plan

1. Define Rust models for `ResolvedPromptContext`, `ContextBudgetPlan`, and `ContextRetrievalIncludeMode`.
2. Implement SQLite content resolution mapping for `source_kind`.
3. Implement the token math and budget enforcement loop.
4. Integrate with `ContextSnapshot` to write back inclusion decisions.
5. Create unit tests mocking `ContextPayload` and SQLite to prove deterministic budget dropping and privacy boundary enforcement.
6. (Main/Quick Ask generation remain untouched throughout rollout).

## 14. Final Recommendation

Adopt this architectural boundary for the Agent Context Manager. It enforces strong decoupling between retrieval (finding data), selection (prioritizing data), and management (budgeting and resolving data). By keeping SQLite as the source of truth and writing inclusion decisions back to the Context Snapshot, we guarantee that runs remain fully auditable and replayable without violating privacy or duplicating storage.
