# Phase 5: Agent Runtime Foundation Plan v1.0

## Objective
Establish the foundation of a Loom-native event-driven, cancellable, raw-thinking-safe Agent Runtime inside `loom-service` in Rust.

## Scope & Prerequisites
- Standalone `agent_runtime` module.
- Core types: `AgentRunId`, `AgentRun`, `AgentStep`, `AgentStepKind`, etc.
- Safe event model: `AgentEvent`.
- Thin bridge to `ProviderPipeline` using existing provider infrastructure.
- Complete privacy guardrails: raw model thinking/reasoning must never be serialized or persisted.
- In-memory execution only (no SQLite changes in this phase).
- Dev/internal only, zero impact to production `Main` generation or `Quick Ask`.

## Changelog
- **v1.0**: Initial baseline plan for AGENT-RUNTIME-FOUNDATION-001.
