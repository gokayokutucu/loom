# Test TANTIVY-RETRIEVAL-ADAPTER-001 v1.0

## Adapter Tests

- [x] Build index from SQLite projection candidates.
- [x] Full rebuild from empty index is reproducible.
- [x] Incremental update replaces changed content.
- [x] Tombstoned/deleted chunks are removed from Tantivy.
- [x] BM25 search returns chunk-level identity and positive score.
- [x] Exact term search returns matching candidate.
- [x] Projection identity fields are preserved in results.
- [x] Source-kind filtering limits candidates.
- [x] Diagnostics expose document count, chunk count, index version, projection version, and last rebuild.
- [x] Content digest changes when source content changes.
- [x] Agent runs/events are excluded from retrieval.
- [x] Raw thinking markers are rejected before indexing.

## Validation Commands

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `./loom.sh --publish --test`
- [x] `npm run electron:package:dev`
