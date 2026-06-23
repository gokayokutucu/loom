# Task TOOL-PERMISSION-MODEL-001 v1.0

## Objective

Implement the first Tool Permission Model on top of the Tool Scheduler schema/repository foundation without adding tool execution, MCP runtime, provider calls, UI approval flow, prompt injection, or Context Manager changes.

## Scope

- [x] Read `docs/tool_scheduler_design.md`.
- [x] Read `docs/agent_runtime_event_model.md`.
- [x] Read `docs/subagent_runtime_design.md`.
- [x] Audit Tool Scheduler migration and repository.
- [x] Add typed permission scopes.
- [x] Add permission request creation over existing grant table.
- [x] Add grant status validation behavior.
- [x] Add deny-by-default permission evaluation.
- [x] Add exact run grant lookup.
- [x] Add root run grant lookup.
- [x] Add session/workspace scope lookup within current schema limits.
- [x] Enforce no automatic parent-to-child inheritance.
- [x] Enforce revoked grant denial.
- [x] Enforce expired grant denial.
- [x] Add safe permission diagnostics with counts/status only.
- [x] Keep one-time grant consumption deferred because schema has no consumed marker.
- [x] Keep event integration deferred because repository policy does not own AgentRun event sequencing.

## Out Of Scope

- [x] Tool execution not implemented.
- [x] MCP calls not implemented.
- [x] Provider/model calls not implemented.
- [x] Shell/file/network tool execution not implemented.
- [x] UI approval flow not implemented.
- [x] Tool output prompt/context injection not changed.
- [x] AgentRun state machine not changed.

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

- v1.0: Initial task record for Tool Permission Model repository policy.
