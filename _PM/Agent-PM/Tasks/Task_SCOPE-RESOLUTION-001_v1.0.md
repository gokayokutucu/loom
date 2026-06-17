# Task SCOPE-RESOLUTION-001 v1.0

## Goal

Implement the Scope Resolution foundation based on `SCOPE-RESOLUTION-DESIGN-001`.

## Checklist

- [x] Audit branch and working tree.
- [x] Inspect Scope Resolution design.
- [x] Inspect retrieval services and adapters.
- [x] Inspect SQLite repositories for Looms, Wefts, Responses, References, Attachments, Memories, and Context Artifacts.
- [x] Inspect existing privacy guards.
- [x] Add Scope Resolution service module.
- [x] Add Scope Resolution request/context/descriptor contracts.
- [x] Add scope type/status/visibility contracts.
- [x] Add privacy-safe diagnostics.
- [x] Add current conversation discovery.
- [x] Add Weft origin chain discovery with hidden/background visibility.
- [x] Add reserved project/project attachment/tool-MCP scopes.
- [x] Add scoped/global memory count discovery.
- [x] Add conversation attachment count discovery.
- [x] Add scoped/cross-conversation/archived retrieval descriptors.
- [x] Add `RetrievalQuery.loom_ids` support.
- [x] Add Tantivy multi-Loom filtering.
- [x] Add LanceDB multi-Loom filtering.
- [x] Add Hybrid Retrieval loom allowlist pass-through.
- [x] Add targeted Rust tests.
- [x] Run full validation.
- [x] Run fresh runtime verification.
- [x] Run Electron packaged validation.
- [x] Commit with `feat: add scope resolution foundation`.

## Scope Guard

- [x] No prompt assembly.
- [x] No token budgeting.
- [x] No Context Manager implementation.
- [x] No Memory Policy implementation.
- [x] No Tool/MCP execution.
- [x] No UI changes.
- [x] Main generation remains untouched.
- [x] Quick Ask remains untouched.

## Validation Evidence

- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`: passed.
- `cargo check --manifest-path services/loom-service/Cargo.toml`: passed.
- `cargo test --manifest-path services/loom-service/Cargo.toml`: passed, 899 tests.
- `npm run service:check`: passed.
- `npm run service:test`: passed, 899 tests.
- `npm run build`: passed.
- `npx vitest run`: passed, 559 tests.
- `git diff --check`: passed.
- `./loom.sh --publish --test`: passed after rerun with loopback bind permission; sandboxed run was blocked by local test-server bind permission.
- `npm run electron:package:dev`: passed.
- Fresh debug `/health`: passed on `127.0.0.1:17652`, `runtime_binary_mismatch=false`.
- Packaged sidecar `/health`: passed on `127.0.0.1:17653`, packaged/release fingerprints matched, `runtime_binary_mismatch=false`.
