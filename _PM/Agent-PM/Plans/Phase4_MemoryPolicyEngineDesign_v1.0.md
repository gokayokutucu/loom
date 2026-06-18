# Phase 4 - Memory Policy Engine Design v1.0

## 1. Objective
Design the Memory Policy Engine for Loom. The engine will dictate how memories are formed (write pipeline), retrieved (read pipeline), ranked, and safely exposed to the Context Manager, while strictly enforcing privacy boundaries and SQLite-as-source-of-truth rules.

## 2. Taxonomy and Scope
- **Core Memory Definition:** A persistent unit of knowledge extracted from user interactions, explicitly saved context, or agent observations. The existing `memories` table from migration 0013 serves as the baseline, which the MPE extends.
- **Memory Types (mapped to existing `memory_type` values):**
  - `explicit_user_memory`: Manually saved facts or preferences by the user.
  - `profile_preference`: System-level or profile-level user preference settings.
  - `inferred_preference`: Implicit observations about user goals or intent extracted from behavior.
  - `system_note`: Internal system state notes.
- **Scope:** The Memory Policy Engine acts as the lifecycle manager for long-term state. It operates independently from the transient Context Manager. Its read policy defines eligibility rules for Context Selection, and its write pipeline observes completed Responses to generate new knowledge.

## 3. Privacy Boundaries & Non-Negotiable Rules
- **SQLite is Source of Truth:** All memories MUST be stored canonically in SQLite. Search projections (Tantivy/LanceDB) are strictly rebuildable from SQLite and must never hold the only copy of a memory.
- **No Raw Thinking:** Raw model thinking, chain-of-thought, or internal monologue must NEVER be persisted as memory, nor should it ever enter the memory extraction pipeline.
- **Forbidden Markers Validation:** Any content flowing into the write pipeline must be validated against `FORBIDDEN_CONTENT_MARKERS` (e.g., `raw_thinking`, `thinking_text`, `chain_of_thought`, `hidden_reasoning`, `provider_payload`, `provider_delta`, `authorization`, `bearer`). Privacy gates apply to both extraction input and extraction output. Matches must result in immediate rejection.

## 4. Pipeline Separation
The architecture strictly separates the memory write policy from the memory read policy to ensure independent scaling, security, and predictability.

### 4.1 Memory Write Policy (Extraction & Persist)
The write pipeline is asynchronous and triggered post-generation or via explicit user action.
1. **Trigger:** Background extraction worker runs after a Response is fully persisted, or synchronously when a user manually saves a memory.
2. **Input Sanitization Gate:** Context flowing to the extractor is scrubbed and validated against forbidden markers.
3. **Extraction & Synthesis:** A dedicated deterministic or LLM-based worker extracts structured facts and preferences from the sanitized context.
4. **Output Sanitization Gate:** The LLM extraction output is validated against `FORBIDDEN_CONTENT_MARKERS`. If forbidden markers are found, the entire extraction payload is rejected, and the rejection is logged to `memory_events` with `event_type = sanitization_rejection`.
5. **Conflict Resolution:** If a new memory contradicts an existing one:
   - Identify conflict using the conflict detection key.
   - Older memories are marked as superseded.
   - The new memory is inserted.
6. **Persistence:** Written canonically to the existing `memories` table. Provenance lifecycle events are appended to the existing `memory_events` log.
7. **Projection Sync:** The new memory ID is queued for indexing in Tantivy/LanceDB.

### 4.2 Memory Read Policy (Retrieval & Ranking)
The read policy defines eligibility rules but does not duplicate hydration.
1. **Scope Verification:** Scope Resolution answers *where* it is valid to look by providing scope boundaries (`loom_ids`). It never owns query text.
2. **Projection Query:** Hybrid Retrieval uses the active user prompt and the ScopeContext allowlists (from Scope Resolution) to execute retrieval against Tantivy/LanceDB and find candidate memory IDs.
3. **Verification & Delivery:** Context Selection performs SQLite verification for memory candidates to ensure they still exist and are not soft-deleted. The Context Manager then fetches the full memory content from SQLite when selected. The MPE does not perform a distinct read hydration stage itself.

## 5. Conflict Resolution & Tombstoning Strategy
- **Conflict Key:** Defined for v1 as exact match on `(topic_key, source_loom_id, memory_type)`. Semantic similarity conflict detection is deferred. Note: `source_loom_id` represents the applicable scope field.
- **Temporal Dominance:** Newer extractions override older ones matching the conflict key.
- **Explicit Priority:** Explicitly saved memories (`explicit_user_memory`) outrank inferred observations.
- **User Forget Semantics:** When a user explicitly initiates a forget action, the memory row is soft-deleted via `deleted_at` (no hard delete) and a `memory_events` row is created. Tombstoned memories are excluded from retrieval and context selection. Existing context snapshots referencing historical memory IDs will resolve them as deleted if opened later.

## 6. Always Include Semantics
- Eligible memories with `always_include=1` map to Tier 1 PolicyAlwaysInclude during Context Selection.
- In v1, only `explicit_user_memory` or `profile_preference` can be marked as `always_include`.
- An `inferred_preference` cannot become `always_include` without explicit user confirmation.
- If Tier 1 context exceeds the token budget, Context Manager returns an explicit overflow error rather than silently truncating.

## 7. Diagnostics and Provenance Model
To ensure Agent Runs can be audited and debugged:
- **Write Diagnostics:** Provenance and history use the existing `memory_events` table as an append-only log. The `memories` table tracks state.
- **Read Diagnostics:** Retrieved memories must log their involvement in the `ContextSnapshot`.

## 8. Next Recommended Task: MEMORY-POLICY-SQLITE-001
Update the existing schema to support the MPE.
**Should:**
- Add a migration that ALTERs the existing `memories` table to include new nullable columns:
  - `supersedes_id TEXT REFERENCES memories(memory_id)`
  - `always_include INTEGER NOT NULL DEFAULT 0`
  - `origin_response_id TEXT`
  - `extraction_method TEXT CHECK(extraction_method IN ('explicit', 'llm_extraction', 'system'))`
  - `confidence REAL`
  - `topic_key TEXT`
  *(Reuse `origin_loom_id` if it already exists, or mention it only if audit confirms it is needed)*
- Extend `MemoryRecord` / `NewMemory` DTOs.
- Update repository methods.
- Use `memory_events` for provenance lifecycle events.

**Must NOT:**
- Create a new `memories` table.
- Create an undefined `memory_provenance` table.
- Implement LLM extraction or background worker.
- Implement full conflict resolution beyond schema support.
- Change Context Manager, Retrieval, or Scope Resolution.

## 9. Implementation Readiness Checklist
MEMORY-POLICY-SQLITE-001 readiness checklist:
- [x] existing schema acknowledged
- [x] exact migration columns listed
- [x] memory_events role defined
- [x] memory_provenance not required
- [x] conflict key defined
- [x] always_include defined
- [x] output sanitization defined
- [x] Scope Resolution boundary fixed
- [x] read hydration duplication removed
