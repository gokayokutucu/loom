# Task: AGENT-RUN-PERSISTENCE-001 v1.0

- [x] Add SQLite migration 0022: `agent_runs`, `agent_steps`, `agent_events` tables
- [x] Create `storage/repositories/agent_runs.rs` with `AgentRunRepository` (full CRUD + append-only event log)
  - Insert run, insert step, append event, finish run (atomic), cancel run, recover interrupted runs
  - `get_run`, `list_runs_for_loom`, `list_steps_for_run`, `list_events_for_run`
  - Privacy enforcement: `FORBIDDEN_THINKING_KEYS` checked on every event append
  - 12 unit tests covering all methods including privacy guards and idempotency
- [x] Create `agent_runtime/event_writer.rs` with safe payload allowlist
  - `event_to_safe_record()` maps each `AgentEvent` variant to `Option<(&'static str, Option<String>)>`
  - Allowlist: RunStarted, StepStarted, ProviderCompleted (usage only), ToolCallRequested, ToolPermissionEvaluated, ToolCallSkipped, ToolCallCompleted (no output_summary), ToolCallFailed (error_code only), ArtifactCreated, Warning
  - Returns `None` for: ProviderDelta (delta text excluded), terminal events (handled by `finish_run`)
  - 6 unit tests verifying the allowlist
- [x] Update `agent_runtime/runtime.rs`:
  - `AgentRunId` generated as UUID v4 via `new_agent_run_id()`, independent of `responseId`
  - `AgentRunStatus::Interrupted` variant added and all match arms updated
  - `AgentRunStore::all_run_ids()` helper for test support
  - `AgentRuntime<R>` struct holds `Option<AgentRunRepository>`
  - `with_repository(repo)` builder method
  - `persist_event()` and `finish_run_in_repo()` async helpers
  - Tests: `extract_run_id()` helper, `test_execute_run_uses_uuid_run_id_not_response_id`, `test_agent_runtime_run_has_correlation_id_equal_to_run_id`, `interrupted_run_in_store_is_terminal_for_cancel`
- [x] Update `agent_runtime/service.rs`:
  - `from_ollama_with_store_registry_and_repo()` production constructor
  - All tests updated to extract run_id from `RunStarted` event (UUID, not response_id)
- [x] Update `api/state.rs`: `AppState` gains `agent_run_repository: AgentRunRepository` field
- [x] Update `api/mod.rs`: wire `AgentRunRepository::from_pool(database.pool())` before `AppState`; mount 4 history GET routes when experimental API enabled
- [x] Update `main.rs`: call `recover_interrupted_runs()` on startup after cleanup
- [x] Update 14 API test files to add `agent_run_repository` field to `AppState` test helpers
- [x] Update `api/agent_experimental.rs`:
  - Add `AgentRunStatus::Interrupted => "interrupted"` to `status_label()`
  - Add 4 history route handlers: `list_runs`, `get_run_history`, `list_steps`, `list_events`
  - Add history route path constants
  - Add 8 history route tests in `router_gate::history_routes` submodule
- [x] `cargo fmt`, `cargo check`, `cargo test` — 833 tests, 0 failures

## Decision Notes

- **AgentRunId is UUID v4**, not derived from `responseId`. `responseId` is stored as a separate reference column. This required updating all tests that previously asserted `run_id == responseId`.
- **Opt-in persistence via `Option<AgentRunRepository>`**. Tests that don't wire a database pass `None` and run unchanged. Database-backed tests use `from_ollama_with_store_registry_and_repo()`.
- **Terminal event atomicity**: `finish_run()` uses a single SQLite transaction to UPDATE `agent_runs.status` and INSERT the terminal event, preventing races between status and event.
- **`has_more` heuristic for events**: `has_more = count == limit`. Avoids a second COUNT(*) query; callers that get fewer than `limit` events know there are no more.
- **History routes return safe DTOs only**: `AgentRunRecord`, `AgentStepRecord`, `AgentEventRecord` are defined to never include prompt, thinking, delta text, or secrets — safe-by-construction, no post-hoc scrubbing needed.

## Future Tasks

- AGENT-UI-RUN-INSPECTOR-001
- AGENT-CONTEXT-MANAGER-001
- RETRIEVAL-ARCH-001

## Post-Implementation Validation

Strict validation found that the initial commit did not persist runtime step rows and could append a second terminal event after a run was already terminal. These findings are addressed by the dedicated post-validation follow-up documented in `Task_AGENT-RUN-PERSISTENCE-001_POST-VALIDATION_v1.0.md`.
