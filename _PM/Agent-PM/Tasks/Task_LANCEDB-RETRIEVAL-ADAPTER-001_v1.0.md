# Task LANCEDB-RETRIEVAL-ADAPTER-001 v1.0

## Goal

Implement a LanceDB-backed semantic/vector retrieval projection adapter.

## Checklist

- [x] Audit Retrieval Architecture and SQLite Projection Contracts.
- [x] Confirm canonical projection identity remains unchanged.
- [x] Audit existing Tantivy adapter boundary.
- [x] Add LanceDB and Arrow dependencies.
- [x] Add provider-neutral embedding boundary.
- [x] Add LanceDB adapter module.
- [x] Add explicit search request/result/candidate contracts.
- [x] Build LanceDB projection from `RetrievalProjectionRepository`.
- [x] Implement full rebuild.
- [x] Implement incremental upsert.
- [x] Implement tombstone/delete handling.
- [x] Implement vector similarity search.
- [x] Implement source filtering.
- [x] Preserve chunk-level candidate identity and vector score metadata.
- [x] Store projection diagnostics metadata only.
- [x] Add privacy tests for raw thinking and agent audit exclusion.
- [x] Add no Ollama-only embedding coupling guard.
- [x] Run full validation.
- [x] Run Electron package build validation.
- [x] Run packaged sidecar launch validation.
- [ ] Commit with `feat: add lancedb retrieval adapter`.

## Scope Guard

- [x] No hybrid fusion.
- [x] No reranking.
- [x] No Context Manager integration.
- [x] No prompt assembly.
- [x] No Main generation changes.
- [x] No Quick Ask changes.
- [x] No Agent Runtime behavior changes.
- [x] No UI.
