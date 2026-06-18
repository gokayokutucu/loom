# Task CONTEXT-SELECTION-SERVICE-001 v1.0

## Goal

Implement the metadata-only Context Selection Service foundation.

## Checklist

- [x] Audit branch and working tree.
- [x] Inspect Context Selection, Scope Resolution, and Context Snapshot designs.
- [x] Inspect Scope, Retrieval, Snapshot, and SQLite contracts.
- [x] Add Context Selection contracts and service.
- [x] Add structural and retrieval candidate transformation.
- [x] Add strict tier-first and within-tier ordering.
- [x] Add cross-Loom and archived caps.
- [x] Add privacy-safe diagnostics.
- [x] Add optional Context Snapshot persistence.
- [x] Add focused tests.
- [x] Run full validation.
- [x] Run fresh runtime verification.
- [x] Run Electron packaged validation.
- [x] Commit with `feat: add context selection service`.

## Scope Guard

- [x] No prompt assembly.
- [x] No full content persistence.
- [x] No Context Manager implementation.
- [x] No Memory Policy implementation.
- [x] No Agent Behavior integration.
- [x] No Tool/MCP execution.
- [x] Main generation and Quick Ask remain untouched.
- [x] No agent-run snapshot linkage mutation.

## Contract Note

Policy inputs are metadata-only references in this implementation. This intentionally narrows the older contract design, which allowed policy-entry content, to satisfy the current task's stronger no-prompt/no-content boundary.

## Validation Evidence

- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`: passed.
- `cargo check --manifest-path services/loom-service/Cargo.toml`: passed.
- `cargo test --manifest-path services/loom-service/Cargo.toml`: passed, 916 tests. The initial sandboxed run had two loopback bind permission failures; unrestricted rerun passed.
- `npm run service:check`: passed.
- `npm run service:test`: passed, 916 tests.
- `npm run build`: passed.
- `npx vitest run`: passed, 559 tests.
- `git diff --check`: passed.
- `./loom.sh --publish --test`: passed.
- `npm run electron:package:dev`: passed.
- Fresh debug `/health`: ready on `127.0.0.1:17658`, PID observed locally, fingerprint verified, inode omitted; process stopped and port released.
- Packaged binary fingerprint verified (sha256 matched, fingerprint omitted per hygiene rules).
- Packaged sidecar health smoke passed: binary launched from `dist-electron/Loom.app`, isolated temp DB/config, `/health` returned `status: ready`, `lifecycleState: ready`, `database.status: ready`, `buildProfile: release`; reported binary fingerprint matches computed sha256; process stopped, port released, temp dir cleaned.
