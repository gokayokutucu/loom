# Task: AGENT-BEHAVIOR-FOUNDATION-001 v1.0

- [x] Read required runtime, event, provider concurrency, subagent, ledger, and PM documents.
- [x] Audit existing Agent Runtime, storage repository, and migration patterns.
- [x] Add `.gitignore` entries for `CLAUDE.md` and `scratch/`.
- [x] Add AgentDefinition persistence support with privacy validation.
- [x] Add AgentRun root/parent run-tree support.
- [x] Add executable AgentRun state machine repository transitions.
- [x] Add lifecycle event emission for required run events.
- [x] Add idempotent cascade cancellation for descendants.
- [x] Add tests for required transitions.
- [x] Add tests for parent cancellation cascade.
- [x] Add tests for event order.
- [x] Add tests for idempotent cancellation.
- [x] Run full required validation stack.
- [x] Commit locally without pushing.

## Out of Scope Confirmed

- No provider execution behavior added.
- No tool scheduler or tool execution added.
- No planner added.
- No memory extraction added.
- No A2A added.
- No UI or retrieval changes added.

## Validation Evidence

- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`: passed.
- `cargo check --manifest-path services/loom-service/Cargo.toml`: passed.
- `cargo test --manifest-path services/loom-service/Cargo.toml`: 956 passed.
- `npm run service:check`: passed.
- `npm run service:test`: 956 passed.
- `npm run build`: passed with existing Vite chunk warnings.
- `npx vitest run`: 32 files / 559 tests passed.
- `./loom.sh --publish --test`: passed after rerun outside the sandbox because local test-server binds were denied in the restricted sandbox.
- `npm run electron:package:dev`: passed.
- Electron icon packaging checks: source `public/loom_logo.icns` exists, packaged `loom_logo.icns` exists and matches, `electron.icns` is absent, and `CFBundleIconFile` is `loom_logo.icns`.
