# Task HYBRID-RETRIEVAL-SERVICE-001 v1.0

## Goal

Implement Hybrid Retrieval Service based on accepted Agent Phase 2 retrieval architecture.

## Checklist

- [x] Audit branch and working tree.
- [x] Inspect retrieval architecture source of truth.
- [x] Inspect Tantivy adapter contract.
- [x] Inspect LanceDB adapter contract.
- [x] Add hybrid retrieval module.
- [x] Add `HybridRetrievalService`.
- [x] Add stable query/result/candidate/diagnostic contracts.
- [x] Support `Hybrid`, `KeywordOnly`, and `SemanticOnly` modes.
- [x] Implement source degradation diagnostics.
- [x] Implement RRF with `k=60`.
- [x] Implement domain rank pre-shift.
- [x] Implement dedupe by projection identity.
- [x] Keep `content_digest` diagnostic-only.
- [x] Preserve BM25/vector rank signals.
- [x] Bound and sanitize previews.
- [x] Exclude agent audit source kinds defensively.
- [x] Run full validation.
- [x] Run fresh runtime verification.
- [x] Run Electron packaged validation.
- [x] Commit with `feat: add hybrid retrieval service`.

## Scope Guard

- [x] No prompt assembly.
- [x] No token budgeting.
- [x] No Context Manager integration.
- [x] No memory writes.
- [x] No Agent Behavior integration.
- [x] No MCP.
- [x] No Tool Execution.
- [x] No UI.
