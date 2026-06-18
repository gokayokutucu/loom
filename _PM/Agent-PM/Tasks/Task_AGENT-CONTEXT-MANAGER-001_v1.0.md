# Task AGENT-CONTEXT-MANAGER-001 v1.0

## Goal

Implement the provider-neutral Agent Context Manager between Context Selection and prompt assembly.

## Checklist

- [x] Audit branch, prerequisite commits, and existing snapshot-linking work.
- [x] Read the Phase 3 design and required service boundaries.
- [x] Add `AgentContextManager` and structured `FinalContext` contracts.
- [x] Resolve candidate content from canonical SQLite records.
- [x] Apply include modes and deterministic token budgeting.
- [x] Preserve mandatory context or return explicit overflow.
- [x] Finalize metadata-only Context Snapshot decisions.
- [x] Link finalized snapshots to Agent Runs.
- [x] Keep providers, Main, Quick Ask, tools, MCP, and memory writes untouched.
- [x] Complete full validation.
- [x] Complete fresh debug and packaged runtime verification.
- [x] Commit with `feat: implement agent context manager`.

## Schema Note

`Final candidate outcomes use the existing `is_selected`, `rejection_reason`, `include_mode_hint`, and `estimated_tokens` fields. No new migration is required.
