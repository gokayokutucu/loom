# Phase 2 Tantivy Retrieval Adapter v1.0

## Objective

Implement the first external retrieval adapter as a Tantivy-backed lexical projection over SQLite-owned retrieval candidates.

SQLite remains the source of truth. Tantivy is rebuildable and owns no authoritative Loom knowledge.

## Scope

- Add a Tantivy adapter boundary that consumes `RetrievalProjectionRepository`.
- Preserve canonical identity: `source_kind`, `source_id`, `chunk_ref`, `content_digest`, `projection_version`.
- Support full rebuild, incremental upsert, tombstone deletion, keyword/BM25 search, exact term search, source filtering, and chunk-level candidates.
- Store only projection diagnostics metadata beside the Tantivy index.

## Out of Scope

- LanceDB.
- Embeddings.
- Semantic search.
- Hybrid fusion.
- Reranking.
- Prompt assembly.
- Context Manager integration.
- Memory writes.
- Agent Behavior integration.

## Privacy Boundary

Tantivy indexes only eligible SQLite projection candidates. It must never index agent runs/events, provider payloads, provider delta text, prompt envelopes, secrets, credentials, or raw thinking markers.

## Rollout Notes

This is a projection adapter implementation only. Product/runtime routing to Tantivy retrieval remains a later task.
