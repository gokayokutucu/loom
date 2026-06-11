# Task: AGENT-RUNTIME-FOUNDATION-001 v1.0

- [x] Create `services/loom-service/src/agent_runtime/mod.rs`
- [x] Create `services/loom-service/src/agent_runtime/types.rs` with core type definitions
- [x] Create `services/loom-service/src/agent_runtime/events.rs` with safe `AgentEvent` contracts
- [x] Create `services/loom-service/src/agent_runtime/runtime.rs` containing `AgentRuntime`
- [x] Register the new module in `services/loom-service/src/main.rs` (the crate is a binary crate; there is no `lib.rs`)
- [x] Implement `ProviderPipeline` bridge inside `agent_runtime/runtime.rs`
- [x] Filter out all thinking/reasoning events inside the pipeline event translation
- [x] Add unit tests verifying run/step event sequences
- [x] Add unit tests verifying raw thinking is never emitted or serialized in `AgentEvent`
- [x] Add unit tests verifying provider failure mapping
- [x] Run cargo fmt, check, and test validation
- [x] Validate changes via `./loom.sh --publish --test`

## Decision Notes

- **AgentScope intentionally not used.** No external agent framework (no LangChain, no CrewAI, no AgentScope) was added or investigated. The Agent Runtime is **Loom-native**, built directly on the existing `ProviderPipeline`.
- **Foundation-only.** This task delivers lifecycle, event model, run state, and placeholders only. No retrieval, no real tool execution, no autonomous planning, no MCP.
- **Retrieval is explicitly deferred** to RETRIEVAL-ARCH-001. LanceDB and Tantivy are future *indexes only* and must remain rebuildable from SQLite.
- **SQLite remains the source of truth.** No SQLite tables or migrations were added in this task; run state is in-memory only (`AgentRunStore`).
- **No public HTTP API route yet.** The runtime is internal Rust foundation, exercised via unit tests through a trait-compatible fake registry.
- **Privacy by construction.** `AgentEvent` has no variant capable of carrying raw thinking, hidden reasoning, secrets, or Authorization headers; provider `ThinkingDelta`/`ThinkingStatus` events are dropped, and `ProviderDelta` text passes through sanitization.

## Future Tasks

- RETRIEVAL-ARCH-001
- AGENT-CONTEXT-MANAGER-001
- AGENT-MEMORY-001
- AGENT-BEHAVIOR-001
- TOOL-RUNTIME-BOUNDARY-001
- MCP-BOUNDARY-001
- AGENT-RUN-PERSISTENCE-001
- AGENT-UI-RUN-INSPECTOR-001
