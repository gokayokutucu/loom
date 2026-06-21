# Task TOOL-SCHEDULER-SCHEMA-001 v1.0

## Objective

Implement the SQLite schema and Rust storage foundation for the Loom Tool Scheduler without adding tool execution, MCP runtime, provider calls, UI, prompt injection, filesystem access, or shell execution.

## Scope

- [x] Read `docs/tool_scheduler_design.md`.
- [x] Read frozen agent runtime and event contracts.
- [x] Add migration `0028_tool_scheduler_foundation.sql`.
- [x] Add `tool_definitions` table.
- [x] Add `tool_invocations` table.
- [x] Add `tool_artifacts` table.
- [x] Add `tool_permission_grants` table.
- [x] Add Rust storage repository foundation.
- [x] Add safe DTOs for persisted scheduler records.
- [x] Add create/list/get methods for tool definitions.
- [x] Add create invocation method.
- [x] Add invocation status transition method.
- [x] Add create artifact reference method.
- [x] Add create/revoke permission grant methods.
- [x] Preserve AgentRun state machine behavior.
- [x] Avoid raw tool payload, stdout/stderr, file content, prompt, provider payload, secret, and raw thinking persistence.

## Out Of Scope

- [x] Tool execution not implemented.
- [x] Tool scheduler runtime not implemented.
- [x] MCP calls not implemented.
- [x] Provider/model calls not implemented.
- [x] Permission approval UI not implemented.
- [x] Prompt/context injection not changed.

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

- v1.0: Initial task record for Tool Scheduler schema and repository foundation.
