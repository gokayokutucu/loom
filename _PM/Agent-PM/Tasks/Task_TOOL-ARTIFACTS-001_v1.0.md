# Task TOOL-ARTIFACTS-001 v1.0

## Objective

Implement the first Tool Artifact lifecycle foundation on top of the existing Tool Scheduler schema and permission model without adding tool execution, MCP runtime, provider calls, UI artifact viewing, prompt injection, Context Manager changes, or AgentRun state-machine changes.

## Scope

- [x] Read `docs/tool_scheduler_design.md`.
- [x] Read `docs/agent_runtime_event_model.md`.
- [x] Read `docs/subagent_runtime_design.md`.
- [x] Audit Tool Scheduler migration and repository.
- [x] Add supported artifact kind validation.
- [x] Add semantic artifact visibility validation.
- [x] Preserve locked `0028` stored visibility values through repository mapping.
- [x] Create artifact references safely.
- [x] Read artifact references by `artifact_id`.
- [x] List artifact references by `invocation_id`.
- [x] List artifact references by `agent_run_id`.
- [x] List artifact references by `root_run_id`.
- [x] Soft-delete artifact references by setting `deleted_at`.
- [x] Hide deleted artifacts from default get/list methods.
- [x] Add explicit include-deleted repository paths.
- [x] Keep storage references metadata-only.
- [x] Reject forbidden artifact metadata markers.

## Out Of Scope

- [x] Tool execution not implemented.
- [x] MCP calls not implemented.
- [x] Provider/model calls not implemented.
- [x] Shell/file/network tool execution not implemented.
- [x] UI artifact viewer not implemented.
- [x] Raw tool output prompt/context injection not changed.
- [x] Context Manager not changed.
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

- v1.0: Initial task record for Tool Artifact lifecycle repository policy.
