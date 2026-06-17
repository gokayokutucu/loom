# Agent Phase 3B: Context Manager Implementation Plan v1.0

## Objective

Implement the Agent Context Manager for Loom agent turns, based on the accepted design from
AGENT-CONTEXT-MANAGER-DESIGN-001 (Phase 3A).

The Agent Context Manager receives a typed `ContextPayload` from Context Selection and
produces a token-budgeted, prompt-ready context assembly for agent provider dispatch.

## Status

Deferred. Depends on:
- AGENT-CONTEXT-SELECTION-ARCH-001 (Agent Phase 2G) — design accepted
- AGENT-CONTEXT-MANAGER-DESIGN-001 (Agent Phase 3A) — design accepted
- RETRIEVAL-DIAGNOSTICS-001 (Agent Phase 2F) — complete

## Changelog
- **v1.0**: Initial implementation plan (AGENT-CONTEXT-MANAGER-001).

---

## Scope

- Implement `AgentContextManager` in `loom-service`.
- Consume `ContextPayload` from Context Selection.
- Resolve full content from SQLite by `(source_kind, source_id)` for each included entry.
- Apply `ContextRetrievalIncludeMode` per resolved entry.
- Allocate token budget using `ContextBudgetPlan` conventions.
- Assemble prompt context sections per source category.
- Write a minimal, content-free context snapshot via `agent_runs.context_snapshot_id`.
- Enforce all privacy invariants at assembly time.

## Out of Scope

- Context Selection logic (Phase 2G).
- Hybrid Retrieval (Phase 2E).
- Memory write policy (AGENT-MEMORY-001 — separate, deferred).
- Attachment implementation (deferred).
- MCP/tool-derived context (Category 11 — deferred).
- Tab-group or project-level context sources (Categories 4, 7 — deferred).
- Global or archived retrieval (Categories 9, 10 — deferred).
- Non-agent generation flows (Main composer, Quick Ask — unchanged).
- UI changes.

## Privacy Boundary

- Raw thinking must never enter assembled context.
- Provider payloads, secrets, credentials, and agent audit data are excluded structurally.
- Context snapshots stored in `agent_runs.context_snapshot_id` contain no prompt text,
  no content, and no source identifiers.
- Weft origin context must never appear in visible transcript or agent event payloads.
