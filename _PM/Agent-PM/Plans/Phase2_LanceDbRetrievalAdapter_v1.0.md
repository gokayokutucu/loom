# Phase 2 LanceDB Retrieval Adapter v1.0

## Objective

Implement the LanceDB-backed semantic/vector retrieval projection adapter over SQLite-owned retrieval candidates.

SQLite remains the source of truth. LanceDB is rebuildable and owns no authoritative Loom knowledge.

## Scope

- Add a LanceDB adapter boundary that consumes `RetrievalProjectionRepository`.
- Preserve canonical identity: `source_kind`, `source_id`, `chunk_ref`, `content_digest`, `projection_version`.
- Add a provider-neutral embedding boundary for projection builds and searches.
- Support full rebuild, incremental upsert, tombstone deletion, vector similarity search, source filtering, chunk-level candidates, and diagnostics.
- Store only vector projection metadata and vectors in LanceDB.

## Out of Scope

- Hybrid fusion.
- Reranking.
- Prompt assembly.
- Context Manager integration.
- Memory writes.
- Agent Runtime behavior changes.
- Tool execution.
- MCP.
- UI.

## Privacy Boundary

LanceDB embeds only eligible SQLite projection candidates. It must never embed or index agent runs/events/steps, provider payloads, provider delta text, prompt envelopes, secrets, credentials, or raw thinking markers.

## Rollout Notes

This is a projection adapter implementation only. Product/runtime routing to semantic retrieval remains a later task.
