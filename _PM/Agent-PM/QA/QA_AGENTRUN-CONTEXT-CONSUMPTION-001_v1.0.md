# QA: AGENTRUN-CONTEXT-CONSUMPTION-001 v1.0

## Scope QA

- [x] Uses legacy `ContextManager` first per Option A.
- [x] Does not replace `ContextManager` with `AgentContextManager`.
- [x] Does not change contributor behavior.
- [x] Does not change attachment, capsule, Weft, reference, memory, or retrieval behavior.
- [x] Does not change Quick Ask.
- [x] Does not change Main Generation API behavior.
- [x] Does not bridge ProviderRuntime.
- [x] Does not add tool or MCP execution.
- [x] Does not add migrations.
- [x] Does not persist raw prompts.
- [x] Does not persist raw context body.
- [x] Does not persist raw attachment/capsule/provider payloads.
- [x] Does not persist raw thinking.

## Validation QA

- [x] Full Rust validation passed.
- [x] Full npm validation passed.
- [x] Loom publish/test validation passed.
- [x] Electron dev package validation passed.
- [x] Debug runtime verification passed.
- [x] Electron sidecar verification passed.
- [x] Commit created and push skipped.

## Ledger Recommendation

- [x] Move `AGENTRUN-CONTEXT-CONSUMPTION-001` from ACTIVE to LOCKED after validation and commit.
- [x] Keep `PROVIDER-RUNTIME-BRIDGE-001` on hold until this task is locked.
- [x] Keep `MAIN-GENERATION-AGENTRUN-SHIM-001` next after context consumption is locked.
