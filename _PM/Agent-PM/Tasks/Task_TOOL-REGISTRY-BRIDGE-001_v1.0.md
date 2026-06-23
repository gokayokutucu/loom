# Task TOOL-REGISTRY-BRIDGE-001 v1.0

## Objective

Bridge the legacy `agent_runtime` tool registry compatibility layer to the SQLite-backed Tool Scheduler foundation without adding real tool execution, MCP, providers, UI, migrations, Context Manager changes, or prompt injection.

## Scope

- [x] Read `docs/tool_runtime_registry_drift_audit.md`.
- [x] Read `docs/tool_scheduler_design.md`.
- [x] Audit legacy `agent_runtime/tool_registry.rs`.
- [x] Audit legacy `agent_runtime/tools.rs`.
- [x] Audit legacy `agent_runtime/catalog.rs`.
- [x] Audit SQLite Tool Scheduler repository and runtime.
- [x] Keep old public registry DTOs for compatibility.
- [x] Mark the legacy registry as a compatibility surface in module docs.
- [x] Add conversion from `RegisteredTool` to scheduler definition seed.
- [x] Add conversion from `ToolDefinitionRecord` to compatibility `RegisteredTool`.
- [x] Add `ToolRegistryBridge` backed by `ToolSchedulerRepository`.
- [x] Add idempotent bridge seeding for registered tools.
- [x] Add idempotent bridge seeding for the built-in noop scheduler tool.
- [x] Add scheduler-backed discovery for compatibility registered tools.
- [x] Add catalog seeding into the scheduler repository.
- [x] Add compatibility mapping between old invocation statuses and scheduler statuses.
- [x] Prove permission mapping does not auto-grant child runs.
- [x] Prove no real tool execution is introduced.

## Out Of Scope

- [x] Shell tools not implemented.
- [x] Filesystem tools not implemented.
- [x] Network tools not implemented.
- [x] MCP calls not implemented.
- [x] Provider/model calls not implemented.
- [x] UI approval flow not implemented.
- [x] Context Manager not changed.
- [x] No migration added.
- [x] No push performed.

## Validation Checklist

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] `git diff --check`
- [x] `./loom.sh --publish --test`
- [x] `npm run electron:package:dev`
- [x] Fresh debug service migration verification
- [x] Packaged sidecar migration verification
- [x] Commit created

## Changelog

- v1.0: Initial task record for Tool Registry bridge to the SQLite-backed Tool Scheduler.
