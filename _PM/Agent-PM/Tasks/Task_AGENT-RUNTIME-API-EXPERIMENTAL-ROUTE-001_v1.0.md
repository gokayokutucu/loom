# Task: AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001 v1.0

- [x] Add `services/loom-service/src/api/agent_experimental.rs` with gated `POST /experimental/agent/run`
- [x] Add `ExperimentalApiConfig` + `router_with_experimental` in `api/mod.rs`; default `router()` reads `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API`
- [x] Route DTO with `deny_unknown_fields`, prompt validation (non-empty, ≤32k chars), temperature (finite, 0.0–2.0), maxOutputTokens (1–8192)
- [x] NDJSON stream response (`application/x-ndjson`), one safe `AgentEvent` per line
- [x] Router-level gate tests via `tower::ServiceExt::oneshot` (no env mutation)
- [x] Route-level privacy, options, and DTO-rejection tests
- [x] Extend static guard to sweep all `src/api` modules for agent runtime usage
- [x] Add `tower`/`http-body-util` dev-dependencies for router tests
- [x] PM docs (Plan/Task/Test)
- [x] Full validation incl. `./loom.sh --publish --test`

## Decision Notes

- **Route is experimental and gated.** Mounted only when `LOOM_EXPERIMENTAL_AGENT_RUNTIME_API=1|true`; by default the route does not exist (404, no handler, no AgentRuntimeService execution).
- **Default product behavior unchanged.** Main generation and Quick Ask orchestration untouched; the static guard test now sweeps every `src/api` module (only `agent_experimental.rs` and the `state.rs` accessor may reference the runtime).
- **No frontend integration.** No TypeScript client methods, UI, or Electron/Tauri commands.
- **No SQLite persistence.** AgentRun state remains in-memory; no tables or migrations.
- **No retrieval, no real tool execution, no MCP.** All remain deferred.
- **Raw thinking safety enforced at the route.** Thinking events are dropped before serialization; route tests assert the streamed body contains no `raw_thinking`, `thinking_text`, `chain_of_thought`, `hidden_reasoning`, `Authorization`, or `Bearer`, and the run store never holds prompt text.
- **Cancellation route deferred** to AGENT-RUNTIME-CANCELLATION-001.

## Next Tasks

- AGENT-UI-RUN-INSPECTOR-001
- AGENT-RUNTIME-CANCELLATION-001
- AGENT-RUN-PERSISTENCE-001
- TOOL-RUNTIME-BOUNDARY-001
- MCP-BOUNDARY-001
- RETRIEVAL-ARCH-001
