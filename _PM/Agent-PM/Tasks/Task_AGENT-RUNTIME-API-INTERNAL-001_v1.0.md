# Task: AGENT-RUNTIME-API-INTERNAL-001 v1.0

- [x] Add `services/loom-service/src/agent_runtime/service.rs` with `AgentRuntimeService`
- [x] Add shared `agent_runtime/test_support.rs` fake provider/pipeline harness
- [x] Add `AgentRuntime::with_run_store` and `cancel_run`; `AgentRunStore::request_cancel`
- [x] Register process-lifetime `AgentRunStore` in `AppState` (`agent_runs`) constructed at startup in `api::router`
- [x] Add `AppState::agent_runtime()` internal accessor (per-call service, shared store)
- [x] Update test `AppState` literals across api modules (`agent_runs: Default::default()`)
- [x] Add internal execution, shared-store, privacy, cancellation, and provider-options tests
- [x] Add static guard test that Main/Quick Ask sources do not call the agent runtime
- [x] Run cargo fmt/check/test, npm service checks, build, vitest
- [x] Validate via `./loom.sh --publish --test`

## Decision Notes

- **AgentRuntime is now internally wired/callable** through `AgentRuntimeService` and `AppState::agent_runtime()`.
- **No public route.** `/experimental/agent/run` is NOT exposed; route exposure is gated on AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001 with explicit approval.
- **No frontend integration.** No TypeScript, engine client, Electron, or Tauri changes.
- **No product behavior change.** Main generation and Quick Ask orchestration are untouched and verified by a static guard test; their test helpers only gained the new `agent_runs` app-state field initializer.
- **Retrieval remains deferred** (RETRIEVAL-ARCH-001). LanceDB/Tantivy remain future indexes only.
- **Persistence remains deferred** (AGENT-RUN-PERSISTENCE-001). Run state is in-memory only; SQLite remains the source of truth with no new tables/migrations.
- **Tool execution remains deferred** (TOOL-RUNTIME-BOUNDARY-001); MCP remains deferred (MCP-BOUNDARY-001).
- **Cancellation** is a safe placeholder: store flag + provider pipeline cancel. Cooperative mid-run cancellation is deferred to AGENT-RUNTIME-CANCELLATION-001.
- **Privacy unchanged-or-stronger.** All foundation privacy tests retained; new service-path privacy tests added.

## Next Likely Tasks

- AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001 (only when explicitly approved)
- AGENT-RUN-PERSISTENCE-001
- TOOL-RUNTIME-BOUNDARY-001
- MCP-BOUNDARY-001
- RETRIEVAL-ARCH-001
