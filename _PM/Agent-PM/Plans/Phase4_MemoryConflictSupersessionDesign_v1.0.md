# Phase 4 - Memory Conflict & Supersession Design v1.0

## 1. Architecture Overview
This document outlines the conflict resolution and supersession semantics for the Memory Policy Engine. Before relying on probabilistic Large Language Models (LLMs) to perform semantic deduplication or conflict resolution, Loom relies on a deterministic `topic_key` architecture. This establishes a strict, predictable key-value semantic slotting system for knowledge.

## 2. topic_key Model
**Purpose:** A deterministic, human-readable identifier that groups memories about the same specific semantic subject or configuration axis.
**Format:** Lowercase, dot-separated tokens.
**Allowed Characters:** `[a-z0-9_.]`
**Hierarchy Separator:** `.` (dot)
**Examples:**
- `ui.typography.assistant.font`
- `coding.rust.style.comments`
- `user.preference.language`

## 3. topic_key vs Tags
- **topic_key:** A single canonical slot identifier for conflict resolution. Only one active memory can occupy a `topic_key` per scope. It acts as a primary key for semantic uniqueness.
- **Tags (Future):** Arbitrary, multi-value metadata used for organization, filtering, and search. A memory can have many tags, but at most one `topic_key`.

## 4. Conflict Key
The deterministic tuple used to identify a conflict is:
`(topic_key, source_loom_id)`

*(Note: `memory_type` is intentionally excluded from the conflict key so that explicit and inferred memories on the same topic can collide and be resolved by priority rules.)*

## 5. Supersession Model
When a new memory arrives with a `topic_key` and `source_loom_id` that matches an existing **active** memory:
1. **Supersession Pointer:** The new memory is inserted with `supersedes_id` pointing to the old `memory_id`.
2. **Tombstoning:** The old memory is soft-deleted (`deleted_at = CURRENT_TIMESTAMP`).
3. **Chain Compression:** A memory only supersedes the currently active memory. Long histories form a linked list via `supersedes_id` traversing backwards.
4. **Immutability:** Existing Context Snapshots that referenced the old memory ID are unmodified.

## 6. Explicit vs Inferred Priority
When a conflict occurs across different memory types:
- **Explicit vs Inferred:** If the new memory is `explicit_user_memory` and the old is `inferred_preference`, the explicit memory supersedes the inferred memory.
- **Inferred vs Explicit:** If the new memory is `inferred_preference` and the old is `explicit_user_memory`, the new memory is **rejected/skipped**. Inferred knowledge cannot overwrite explicitly confirmed user facts.
- **Same Type:** Newer supersedes older.
- **Profile Preference:** Treated with the same weight as `explicit_user_memory`.

## 7. Scope Conflict Rules
Scope applies a masking boundary at read-time, rather than a conflict at write-time.
- **Global vs Loom Scope:** A memory with `topic_key = X, source_loom_id = NULL` does not conflict with `topic_key = X, source_loom_id = 123`. Both coexist in the database.
- **Read-Time Masking:** Context Selection will prioritize the Loom-scoped memory over the Global memory for the same `topic_key` when assembling context for Loom 123.
- **Weft/Branch Scope (Future):** Will follow the same masking principle.

## 8. Always Include Conflict Rules
- If an `always_include = 1` memory is superseded by a newly extracted memory, the new memory **does not** automatically inherit `always_include = 1` unless it is an explicit memory specifically requested with the flag.
- Explicit updates via `PATCH` to the same memory mutate the flag directly. Supersession applies when a completely new memory record replaces the old one.

## 9. Forget & Tombstone Interaction
- **Explicit Forget:** Soft-deletes the memory. In v1 (explicit pipeline only), a `topic_key` is freed, allowing a new explicit memory to use the slot.
- **Future Re-Inference Blocking:** When the async background extraction worker is implemented, forgetting an `inferred_preference` must leave a tombstone (e.g., `event_type = tombstoned`) to prevent the worker from immediately re-inferring the same unwanted fact from historical context. Explicit saves will always bypass the tombstone.

## 10. Deduplication vs Conflict
- **Exact Deduplication:** If `normalized_content` exactly matches an active memory in the same scope, the request is rejected as a duplicate. No supersession occurs.
- **Same Topic Conflict:** If `topic_key` matches but `normalized_content` differs, deterministic supersession occurs according to the priority rules.
- **Semantic Conflict (Future):** No `topic_key` match exists, but an LLM determines the content contradicts an existing memory. This is deferred.

## 11. Memory Events Diagnostics
The `memory_events` append-only log will track the supersession lifecycle using metadata-only records (no raw payload text):
- `superseded`: Logged against the old `memory_id` when it is replaced.
- `conflict_skipped`: Logged against the old explicit `memory_id` when an incoming inferred memory is rejected.
- `topic_key_ambiguous` / `topic_key_missing`: Deferred to the LLM extraction diagnostic phase.

## 12. Implementation Rollout Plan
1. **MEMORY-CONFLICT-SUPERSESSION-001 (Ready):** Implement topic-key deterministic supersession logic in the explicit write pipeline repository layer.
2. **MEMORY-TOPIC-KEY-MANUAL-001:** Update API and UI to allow passing a `topic_key` on explicit save.
3. **MEMORY-TOPIC-KEY-AUTO-DESIGN-001:** Design the auto-generation strategy for `topic_key` assignment.
4. **MEMORY-TAG-HIERARCHY-FUTURE:** Multi-tag filtering system for UI organization.
5. **MEMORY-SEMANTIC-CONFLICT-FUTURE:** LLM-based contradiction detection.

## 13. Final Recommendation
The deterministic `topic_key` strategy provides a safe, highly predictable mechanism for superseding memories without risking LLM hallucination or expensive semantic cross-checks. **MEMORY-CONFLICT-SUPERSESSION-001** is ready to implement.
