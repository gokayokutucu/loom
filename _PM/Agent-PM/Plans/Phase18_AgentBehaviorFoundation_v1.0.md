# P18 Agent Behavior Foundation Plan v1.0

## Objective

Implement the first executable Agent Runtime behavior foundation for durable Agent definitions, Agent runs, run-tree identity, lifecycle transitions, and safe runtime events.

## Scope

- Add AgentDefinition persistence metadata without prompt or instruction bodies.
- Add AgentRun root/parent metadata and repository support for run trees.
- Implement the required executable states: `created`, `queued`, `running`, `waiting_tool`, `waiting_subagent`, `completed`, `failed`, `cancelled`.
- Emit safe runtime lifecycle events for create, queue, start, wait, complete, fail, and cancel.
- Make cancellation idempotent and cascade parent cancellation through descendants.
- Preserve provider execution, tools, planner, memory extraction, A2A, retrieval, and UI as out of scope.

## Contract Notes

- `root_run_id` equals `agent_run_id` for root runs and is inherited by children.
- `parent_run_id` is immutable once a child run is created.
- Events carry safe identifiers and state metadata only.
- Prompt text, provider request/response payloads, raw thinking, raw tool output, credentials, and secrets remain forbidden from durable run/event records.

## Validation Plan

- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- `cargo check --manifest-path services/loom-service/Cargo.toml`
- `cargo test --manifest-path services/loom-service/Cargo.toml`
- `npm run service:check`
- `npm run service:test`
- `npm run build`
- `npx vitest run`
- `./loom.sh --publish --test`
- `npm run electron:package:dev`

## Changelog

- v1.0: Initial plan for `AGENT-BEHAVIOR-FOUNDATION-001`.
