# Agent Phase 1B: Agent Run Persistence, Tracing, and Durable Event Log Plan v1.0

## Objective
Add durable, append-only persistence for Agent Runs, Steps, and Events to the Loom-native Agent Runtime. After this phase, all agent runs are recorded in SQLite for history, audit, and future UI inspection — with strict privacy guarantees that raw thinking, delta text, prompts, and secrets are never stored.

## Scope & Prerequisites
- SQLite migration 0022: `agent_runs`, `agent_steps`, `agent_events` tables.
- `AgentRunRepository` with full CRUD and append-only event log.
- `AgentRunEventWriter` (safe payload allowlist): maps each `AgentEvent` variant to a durable record, excluding forbidden content.
- `AgentRuntime` integration with `Option<AgentRunRepository>` — opt-in, no breakage of existing tests.
- Restart recovery: mark interrupted runs on service startup.
- History API: four read-only GET routes gated by `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API`.
- `AgentRunId` as independent UUID v4 (not derived from `responseId`).

## Privacy Rules (Enforced in Code)
- Raw thinking (`raw_thinking`, `thinking_text`, `chain_of_thought`, `hidden_reasoning`) must never be stored.
- Provider delta text must not be stored in `agent_events`.
- Tool output summaries must not be stored.
- Prompt text must not be stored in `agent_runs` or `agent_events`.
- Provider request envelope and API keys/secrets must never be stored.
- Bearer tokens and Authorization headers must never be stored.

## Key Design Decisions
- **AgentRunId is UUID v4**, generated independently of `responseId`. `responseId` is stored as a separate FK reference column on `agent_runs`.
- **Append-only events**: `agent_events` has no UPDATE or DELETE path. `finish_run` atomically combines a STATUS UPDATE on `agent_runs` with a terminal event INSERT.
- **Write-through dual layer**: in-memory `AgentRunStore` for cancellation signals; `AgentRunRepository` (SQLite) for durable history.
- **Opt-in persistence**: `AgentRuntime<R>` holds `Option<AgentRunRepository>`. Tests without a database wire `None` and are unaffected.
- **Restart recovery**: `recover_interrupted_runs()` marks all `pending`/`running` rows as `interrupted` on startup.

## Routes Added (Gated by `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API`)
- `GET /experimental/agent/runs?loomId=…` — list runs for a loom (default limit 50, max 100)
- `GET /experimental/agent/runs/:run_id` — get single run record
- `GET /experimental/agent/runs/:run_id/steps` — list steps for a run
- `GET /experimental/agent/runs/:run_id/events?sinceSequence=…&limit=…` — paginated event log (default limit 100, max 200)

## Changelog
- **v1.0**: Initial plan for AGENT-RUN-PERSISTENCE-001.
