# Task SQLITE-PROJECTION-CONTRACTS-001 v1.0

## Goal

Implement SQLite-side retrieval projection contracts before LanceDB/Tantivy adapters.

## Checklist

- [x] Audit branch, git state, retrieval architecture plan, existing FTS/search patterns, storage schemas, and privacy guards.
- [x] Define stable projection identity contract.
- [x] Add SQLite projection lifecycle metadata migration.
- [x] Add repository contract for deterministic projection candidate enumeration.
- [x] Add SQLite-only full rebuild planning semantics.
- [x] Define source eligibility and forbidden audit/privacy sources.
- [x] Add privacy guards for raw thinking, provider deltas, prompt envelopes, and secrets.
- [x] Add tests for identity, deterministic enumeration, digest changes, tombstones, eligibility, privacy, and no LanceDB/Tantivy dependencies.
- [x] Run full validation.
- [x] Run Electron packaged/dist validation.
- [x] Commit with `feat: add sqlite retrieval projection contracts`.

## Scope Guard

- [x] No LanceDB implementation.
- [x] No Tantivy implementation.
- [x] No vector database integration.
- [x] No hybrid retrieval service.
- [x] No Context Manager.
- [x] No Main generation changes.
- [x] No Quick Ask changes.
- [x] No AgentRun/AgentEvent knowledge indexing.
