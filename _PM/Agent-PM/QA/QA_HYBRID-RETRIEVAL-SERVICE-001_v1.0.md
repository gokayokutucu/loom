# QA HYBRID-RETRIEVAL-SERVICE-001 v1.0

## Architecture

- [x] SQLite remains the source of truth.
- [x] Tantivy remains a rebuildable lexical projection.
- [x] LanceDB remains a rebuildable vector projection.
- [x] Hybrid Retrieval returns candidates only.
- [x] Context Manager integration remains deferred.
- [x] Full content fetch remains a later SQLite read by the consumer.

## Fusion

- [x] RRF is the fusion method.
- [x] RRF `k=60`.
- [x] Domain rank pre-shift is applied before RRF.
- [x] Domain weights match the accepted design.
- [x] Final `relevance_score` is the fused RRF score.
- [x] BM25 and vector scores remain diagnostics.

## Privacy

- [x] No full content is returned.
- [x] Previews are bounded.
- [x] Raw thinking previews are suppressed.
- [x] Secret-bearing previews are suppressed.
- [x] Agent audit source kinds are defensively excluded.
- [x] Diagnostics do not include query text, source ids, chunk refs, digests, vectors, paths, or raw errors.

## Remaining QA

- [x] Full validation passes.
- [x] Fresh debug runtime verification reports `runtime_binary_mismatch=false`.
- [x] Electron packaged build validation passes.
- [x] Packaged sidecar binary matches the release service binary.
- [x] Packaged sidecar launch health smoke passes.
- [x] Packaged app startup smoke passes with temporary HOME and isolated sidecar port.
- [x] Packaged macOS icon rules pass.
