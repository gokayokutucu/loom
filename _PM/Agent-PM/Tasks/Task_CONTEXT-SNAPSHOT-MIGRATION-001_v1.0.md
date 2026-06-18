# Task CONTEXT-SNAPSHOT-MIGRATION-001 v1.0

## Goal

Implement the SQLite schema and repository foundation for privacy-safe Context Snapshots.

## Checklist

- [x] Audit branch and working tree.
- [x] Inspect Context Snapshot design and service architecture documents.
- [x] Inspect migration, repository, agent-run linkage, and privacy patterns.
- [x] Add and register migration 0024.
- [x] Add Context Snapshot records and create-request contracts.
- [x] Add snapshot and candidate repository operations.
- [x] Add transactional snapshot-with-candidates creation.
- [x] Add privacy and functional tests.
- [x] Extend schema privacy guard coverage.
- [x] Run full validation.
- [x] Run fresh debug runtime verification.
- [x] Run Electron packaged validation.
- [x] Commit with `feat: add context snapshot persistence`.

## Scope Guard

- [x] No Context Manager integration.
- [x] No Context Selection Service integration.
- [x] No prompt assembly.
- [x] No full content persistence.
- [x] No provider payload persistence.
- [x] No raw thinking persistence.
- [x] No agent-run linkage mutation.

## Validation Evidence

- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`: passed.
- `cargo check --manifest-path services/loom-service/Cargo.toml`: passed.
- `cargo test --manifest-path services/loom-service/Cargo.toml`: passed, 908 tests. Initial sandboxed run had two loopback bind permission failures; unrestricted rerun passed.
- `npm run service:check`: passed.
- `npm run service:test`: passed, 908 tests.
- `npm run build`: passed.
- `npx vitest run`: passed, 559 tests.
- `git diff --check`: passed.
- `./loom.sh --publish --test`: passed.
- `npm run electron:package:dev`: passed.
- Fresh debug `/health`: ready on `127.0.0.1:17656`, PID `36042`, fingerprint `sha256:812b76cc4536c821d3a5fdc9fc4cb2eaaf4cf5456882b22dca4306cf5f92219a`, inode `196749331`; process stopped and port released.
- Packaged sidecar `/health`: ready on `127.0.0.1:17657`, PID `37659`, fingerprint `sha256:b305369ca3c79912902524f64b266a0ffe904ba1da6b48fe5208889d84705eac`; release fingerprint matched; process stopped and port released.
- Packaged macOS icon contract passed: source and packaged `loom_logo.icns` matched; `electron.icns` absent.
