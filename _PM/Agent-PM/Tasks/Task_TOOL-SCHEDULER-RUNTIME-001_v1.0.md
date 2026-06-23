# Task TOOL-SCHEDULER-RUNTIME-001 v1.0

## Objective

Implement the first Tool Scheduler runtime service seam on top of the existing Tool Scheduler schema, permission model, and artifact lifecycle without adding real tool execution, MCP, provider calls, UI, Context Manager changes, or provider runtime changes.

## Scope

- [x] Read `docs/tool_scheduler_design.md`.
- [x] Read `docs/agent_runtime_event_model.md`.
- [x] Read `docs/subagent_runtime_design.md`.
- [x] Read `docs/provider_concurrency_policy.md`.
- [x] Audit Tool Scheduler repository and migration.
- [x] Add `ToolSchedulerRuntime` service module.
- [x] Accept safe `ToolInvocationRequest` metadata.
- [x] Resolve `ToolDefinition`.
- [x] Evaluate permissions through the existing permission model.
- [x] Create permission-required invocations when grants are missing.
- [x] Create pending permission request records.
- [x] Create permission-denied invocations when denied grants exist.
- [x] Transition granted invocations through queued and running states.
- [x] Add no-I/O noop executor path for tests only.
- [x] Complete noop invocations with sanitized summary only.
- [x] Optionally create metadata-only noop artifact references.
- [x] Support queued/running cancellation via runtime method.
- [x] Support running timeout via runtime method.
- [x] Reject forbidden request metadata before persistence.

## Out Of Scope

- [x] Shell tools not implemented.
- [x] Filesystem tools not implemented.
- [x] Network tools not implemented.
- [x] MCP calls not implemented.
- [x] Provider/model calls not implemented.
- [x] Arbitrary command execution not implemented.
- [x] UI approval flow not implemented.
- [x] Raw tool output prompt/context injection not changed.
- [x] Context Manager not changed.
- [x] Provider runtime not changed.

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

- v1.0: Initial task record for Tool Scheduler runtime seam.
