# Phase 2 Hybrid Retrieval Service v1.0

## Objective

Implement the candidate-only Hybrid Retrieval Service over rebuildable Tantivy and LanceDB
projection adapters.

SQLite remains the source of truth. Tantivy and LanceDB remain rebuildable projections.

## Scope

- Add a stable `RetrievalQuery` to `RetrievalResult` service contract.
- Support `Hybrid`, `KeywordOnly`, and `SemanticOnly` query modes.
- Fuse candidate lists with reciprocal rank fusion (RRF) and domain rank pre-shift.
- Use RRF `k=60`.
- Preserve dedupe identity as `source_kind`, `source_id`, `chunk_ref`, and `projection_version`.
- Treat `content_digest` as diagnostic only.
- Return candidates and safe diagnostics only.

## Out of Scope

- Prompt assembly.
- Token budgeting.
- Context Manager integration.
- Memory writes.
- Agent Behavior integration.
- Tool execution.
- MCP.
- UI.

## Privacy Boundary

Hybrid Retrieval returns bounded candidates only. It must not return full source content,
prompt envelopes, provider payloads, provider deltas, secrets, credentials, raw thinking, or
agent run/event/step audit sources.

## Rollout Notes

This task creates the retrieval query path but does not connect it to Context Manager or product
generation flows. Context Manager remains the later consumer that fetches full SQLite-owned
content by candidate identity.
