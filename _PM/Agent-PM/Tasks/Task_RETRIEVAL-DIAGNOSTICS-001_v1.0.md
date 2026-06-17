# Task RETRIEVAL-DIAGNOSTICS-001 v1.0

## Goal

Implement safe retrieval diagnostics before Context Selection and Context Manager consume Hybrid Retrieval.

## Checklist

- [x] Audit branch and working tree.
- [x] Inspect retrieval architecture source of truth.
- [x] Inspect SQLite projection contracts.
- [x] Inspect Tantivy diagnostics metadata.
- [x] Inspect LanceDB diagnostics metadata.
- [x] Inspect Hybrid Retrieval diagnostics.
- [x] Add retrieval diagnostics module.
- [x] Add projection health diagnostics.
- [x] Add source index health diagnostics.
- [x] Add stale projection detection.
- [x] Add digest mismatch summary.
- [x] Add tombstone count summary.
- [x] Add missing index state.
- [x] Add corrupt index state.
- [x] Add version mismatch state.
- [x] Add safe Hybrid Retrieval diagnostics summary.
- [x] Add privacy tests.
- [x] Run full validation.
- [x] Run fresh runtime verification.
- [x] Run Electron packaged validation.
- [x] Commit with `feat: add retrieval diagnostics`.

## Scope Guard

- [x] No Context Selection.
- [x] No Context Manager.
- [x] No Memory.
- [x] No Tool Execution.
- [x] No MCP.
- [x] No Main generation changes.
- [x] No Quick Ask changes.

## Validation Evidence

- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`: passed.
- `cargo check --manifest-path services/loom-service/Cargo.toml`: passed.
- `cargo test --manifest-path services/loom-service/Cargo.toml`: passed, 887 tests.
- `npm run service:check`: passed.
- `npm run service:test`: passed, 887 tests.
- `npm run build`: passed.
- `npx vitest run`: passed, 559 tests.
- `git diff --check`: passed.
- `./loom.sh --publish --test`: passed after rerun with loopback bind permission; sandboxed run was blocked by local test-server bind permission.
- Fresh debug `/health`: passed on `127.0.0.1:17649`, `runtime_binary_mismatch=false`.
- `npm run electron:package:dev`: passed.
- Packaged sidecar `/health`: passed on `127.0.0.1:17650`, packaged/release fingerprints matched, `runtime_binary_mismatch=false`.
- Packaged app startup smoke: passed on `127.0.0.1:17651`, `runtime_binary_mismatch=false`.
