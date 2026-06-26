# Task QUICK-ASK-AGENTRUN-MODE-001 v1.0

## Objective

Add the lightweight AgentRun mode foundation for Quick Ask without changing the current Quick Ask production endpoint behavior.

## Scope

- [x] Read `docs/quick_ask_agentrun_design.md`.
- [x] Read Agent Runtime type/runtime/repository code.
- [x] Add `AgentRunMode::FullConversation`.
- [x] Add `AgentRunMode::LightweightQuickAsk`.
- [x] Persist AgentRun mode safely in SQLite.
- [x] Keep existing Main Generation and AgentRuntime behavior on `FullConversation`.
- [x] Add reduced lightweight Quick Ask lifecycle support with no steps, context, tools, or snapshots.
- [x] Add tests for mode serialization and persistence.
- [x] Add tests proving lightweight Quick Ask mode creates no AgentRunSteps.
- [x] Leave Quick Ask endpoint behavior unchanged.

## Out Of Scope

- [x] No Quick Ask endpoint wiring.
- [x] No frontend changes.
- [x] No context building for Quick Ask.
- [x] No tools, MCP, snapshots, references, capsules, memory, or AgentRunSteps for Quick Ask.
- [x] No push.

## Status

- [x] Implementation complete.
- [x] Validation complete.
