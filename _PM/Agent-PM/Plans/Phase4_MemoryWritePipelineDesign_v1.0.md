# Phase 4 - Memory Write Pipeline Design v1.0

## 1. Architecture Overview
The Memory Write Pipeline is responsible for safely and deterministically persisting knowledge into the SQLite source of truth (`memories` table), appending provenance history (`memory_events`), and signaling the read projections (Tantivy/LanceDB) for reindexing. The v1 architecture focuses strictly on explicit, user-driven memory operations to establish a secure, privacy-safe foundation before introducing background LLM-based extraction.

## 2. Write Pipeline Entry Points
### Exact Write Entry Points
- **Explicit user save:** "remember this" (Valid for all scopes)
- **Explicit user save with scope:** "remember this for this Loom/project" (Loom-scoped)
- **Explicit always include:** "always use this" (Tier 1 promotion)
- **Explicit forget:** "forget this" (Tombstoning)
- **Future inferred extraction from completed agent run:** Extracts implicit preferences and facts based on behavior.
- **Future system note:** Internal system status or diagnostics stored as memory.

### Scope for v1
- **V1 INCLUDES:** Explicit user save, explicit save with scope, explicit always include, explicit forget.
- **DEFERRED:** Inferred extraction, system notes. No automated LLM extraction in v1 to keep the initial pipeline simple and strictly safe.

## 3. Pipeline Stages
The v1 pipeline executes synchronously for explicit user actions:
1. **Input:** User submits a memory string and optional scope via API.
2. **Scope resolution for memory write:** Determine whether the memory is global or bound to a `source_loom_id`.
3. **Sanitization input gate:** Content is validated against `FORBIDDEN_CONTENT_MARKERS`.
4. **Classification:** Since v1 is explicit only, `memory_type` is automatically set to `explicit_user_memory` or `profile_preference`.
5. **Deduplication:** Exact `normalized_content` and scope match checks.
6. **Conflict detection:** Topic key/scope matching for supersession (if topic key is provided).
7. **Persistence:** Insert into SQLite `memories` table.
8. **Provenance:** Append `created` event to `memory_events`.
9. **Projection Invalidation:** Emit signal to Tantivy/LanceDB to rebuild or incrementally update.

## 4. Explicit Save Semantics
For explicit user memories created in v1:
- `memory_type`: `explicit_user_memory` (or `profile_preference` for global settings).
- `user_confirmed`: `true` (Always true for explicit saves).
- `extraction_method`: `'explicit'`
- `confidence`: `1.0` (User explicit input is 100% confident).
- `topic_key`: Optional in v1. If omitted, no topic-based conflict resolution occurs for that memory. If provided by the UI, it's used for supersession.
- `source_loom_id`: Extracted from the scope resolution (null for global, populated for Loom-scoped).
- `source_response_id` / `origin_response_id`: Populated if the memory was saved via a specific UI response interaction.
- `always_include`: Allowed to be `1` (true).

## 5. Always Include Semantics
- **Allowed memory types:** Only `explicit_user_memory` and `profile_preference`. Inferred preferences cannot be marked as always include without explicit user confirmation.
- **Budget overflow behavior:** If `always_include` memories (Tier 1 Context) exceed the available token budget, the Context Manager will return an explicit overflow error rather than silently truncating, ensuring the user is aware of the constraint.
- **Trigger:** `always_include` requires an explicit user command (e.g., pinning a memory).

## 6. Forget Semantics
- **Identification:** Exact `memory_id`.
- **Soft Delete:** Update `deleted_at = CURRENT_TIMESTAMP`. No hard deletes.
- **Provenance:** Append an event to `memory_events` with `event_type = 'deleted'`.
- **Topic Key Tombstone:** In v1, a soft delete is sufficient since there is no background worker to re-infer the exact same fact. If inferred extraction is added later, a tombstone record might be needed to prevent re-extraction.
- **ContextSnapshots:** Older ContextSnapshots referencing a deleted memory ID will resolve it as deleted (or exclude it) when hydrating historical views.

## 7. Deduplication & Conflict Handling
### Deduplication (v1)
- **Exact text dedupe:** If `normalized_content` exactly matches an existing active memory for the same `source_loom_id` and `memory_type`, the pipeline rejects the insert as a duplicate.
- **Semantic dedupe:** Deferred.

### Conflict Handling (v1)
- **Rules:** Explicit beats inferred.
- **Supersession:** If a new memory shares the exact same `(topic_key, source_loom_id, memory_type)` as an existing active memory, a conflict is detected.
- **Resolution:** 
  1. The new memory is inserted with `supersedes_id` pointing to the old `memory_id`.
  2. The old memory is soft-deleted (`deleted_at = CURRENT_TIMESTAMP`).
  3. `memory_events` logs `created` for the new memory and `superseded` for the old memory.

## 8. Sanitization Model
The write pipeline enforces strict sanitization at the input gate and just before SQLite persistence.
- **Must validate:** Input content, normalized content, and final memory payload.
- **Forbidden content:** The pipeline will reject payloads containing `raw_thinking`, `thinking_text`, `chain_of_thought`, `hidden_reasoning`, provider payloads, prompt envelopes, secrets, credentials, raw tool output, and failed attachment parse content.

## 9. Sync vs Async Model
- **Explicit Saves (v1):** Synchronous. When a user says "remember this", the UI needs immediate confirmation. The operation executes entirely within the API request lifecycle.
- **Background Extraction (Future):** Asynchronous. Will be deferred to a background worker in the orchestration/workflow runner.

## 10. Repository and API Boundaries
### Repository Boundary
The following methods will be implemented in the `MemoryRepository`:
- `create_explicit_memory(...)`
- `forget_memory(memory_id)`
- `supersede_memory(old_memory_id, new_memory)`
- `append_memory_event(memory_id, event_type, payload)`
- `find_by_topic_key(topic_key, source_loom_id, memory_type)`
- `find_duplicate(normalized_content, source_loom_id, memory_type)`
- `list_active_memories_by_scope(source_loom_id)`

### API Boundary
V1 requires explicit API routes to support the UI features:
- `POST /memories` (Save memory)
- `DELETE /memories/:memoryId` (Forget memory)
- `GET /memories` (List memories)
- `PATCH /memories/:memoryId` (Update / toggle always_include)

## 11. Diagnostics Model
A privacy-safe `MemoryWriteDiagnostics` model will be returned for API operations:
- `accepted_count`: Number of memories written.
- `rejected_count`: Number of memories rejected.
- `duplicate_detected`: Boolean flag indicating exact text deduplication triggered.
- `conflict_detected`: Boolean flag indicating topic-key supersession triggered.
- `sanitization_rejected`: Boolean flag indicating forbidden markers were found.
- `event_id`: The ID of the generated `memory_events` record.
- **Privacy Rule:** No raw content, user text, or thinking keys are included in the diagnostics payload.

## 12. Implementation Rollout Plan
- **MEMORY-WRITE-PIPELINE-EXPLICIT-001:** Implement synchronous API endpoints (`POST`, `GET`), Repository methods, and exact-text deduplication.
- **MEMORY-FORGET-001:** Implement `DELETE` endpoint, soft-delete repository logic, and memory events logging.
- **MEMORY-ALWAYS-INCLUDE-001:** Implement `PATCH` endpoint and integrate Tier 1 budget handling with Context Manager.
- **MEMORY-CONFLICT-SUPERSESSION-001:** Implement topic-key based supersession logic.
- **MEMORY-PROJECTION-INVALIDATION-001:** Implement background signaling to Tantivy/LanceDB on memory mutations.
- **MEMORY-BACKGROUND-EXTRACTION-FUTURE:** (Deferred) Asynchronous LLM extraction worker.

## 13. Final Recommendation
The v1 Write Pipeline should be strictly constrained to synchronous, explicit user saves. Deferring the asynchronous LLM extraction (inferred memory) eliminates the immediate need for complex semantic deduplication and LLM failure handling, allowing us to solidify the privacy gates, schema mechanics, and Context Manager read paths first. **MEMORY-WRITE-PIPELINE-EXPLICIT-001 is READY for implementation.**
