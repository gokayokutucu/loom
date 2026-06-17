# QA RETRIEVAL-DIAGNOSTICS-001 v1.0

## Architecture

- [x] SQLite remains the source of truth.
- [x] Tantivy remains a rebuildable lexical projection.
- [x] LanceDB remains a rebuildable vector projection.
- [x] Hybrid Retrieval remains candidate-only.
- [x] Diagnostics do not start Context Selection.
- [x] Diagnostics do not start Context Manager.

## Diagnostics

- [x] Projection source count is reported.
- [x] Projection chunk count is reported.
- [x] Tombstoned chunk count is reported.
- [x] Stale projection state is reported.
- [x] Digest mismatch count is reported.
- [x] Source unavailable/degraded states are reported.
- [x] Safe latency fields are reported.

## Privacy

- [x] No query text is included.
- [x] No full content is included.
- [x] No source ids are included.
- [x] No chunk refs are included.
- [x] No content digest values are included.
- [x] No vectors are included.
- [x] No raw errors or paths are included.
- [x] Raw thinking and secret markers remain excluded.

## Validation QA

- [x] Full validation passes.
- [x] Fresh debug runtime verification reports `runtime_binary_mismatch=false`.
- [x] Electron packaged build validation passes.
- [x] Packaged sidecar binary matches the release service binary.
- [x] Packaged sidecar launch health smoke passes.
- [x] Packaged app startup smoke passes.

## Notes

- The sandboxed `./loom.sh --publish --test` attempt failed because two tests could not bind local loopback servers. The rerun with explicit loopback bind permission passed.
- The packaged app startup smoke proved app launch and sidecar health, but Electron resolved the default macOS application-support config path. The stricter packaged sidecar smoke used isolated temp DB/config paths.
