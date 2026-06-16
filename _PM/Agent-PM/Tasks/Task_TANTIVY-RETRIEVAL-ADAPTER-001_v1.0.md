# Task TANTIVY-RETRIEVAL-ADAPTER-001 v1.0

## Goal

Implement a Tantivy-backed lexical retrieval projection adapter.

## Checklist

- [x] Audit Retrieval Architecture and SQLite Projection Contracts.
- [x] Confirm canonical projection identity remains unchanged.
- [x] Add Tantivy dependency and adapter module.
- [x] Add explicit search request/result/candidate contracts.
- [x] Build index from `RetrievalProjectionRepository`.
- [x] Implement full rebuild.
- [x] Implement incremental upsert.
- [x] Implement tombstone/delete handling.
- [x] Implement keyword/BM25 search.
- [x] Implement exact term search.
- [x] Implement source filtering.
- [x] Preserve chunk-level candidate identity and BM25 score.
- [x] Store projection diagnostics metadata only.
- [x] Add privacy tests for raw thinking and agent audit exclusion.
- [x] Run full validation.
- [x] Run Electron packaged validation.
- [ ] Commit with `feat: add tantivy retrieval adapter`.

## Scope Guard

- [x] No LanceDB.
- [x] No embeddings.
- [x] No semantic search.
- [x] No hybrid retrieval service.
- [x] No Context Manager integration.
- [x] No Main generation changes.
- [x] No Quick Ask changes.
