# Test PROVIDER-RUNTIME-BRIDGE-001 v1.0

## Expected Behavior

The real provider call in both `AgentRuntime::execute_run` and Main Generation's `MainGenerationAgentRunShim` must drive `ProviderRuntimeService`'s safe lifecycle metadata (`requested → queued → running → completed|failed|cancelled`) in lockstep with the real `ProviderPipeline::stream_chat` outcome, without ever performing provider I/O inside `provider_runtime.rs` itself, and without ever persisting a forbidden marker (prompt, provider payload, raw output, secret, raw thinking) into the seam's metadata.

## Test Cases

### `provider_runtime.rs`

- [x] `complete_execution_accepts_custom_safe_summary` — registers a non-noop execution, transitions to running, calls `complete_execution` with a custom safe summary, asserts status `Completed` and the summary round-trips.
- [x] `complete_execution_rejects_forbidden_marker_in_summary` — calling `complete_execution` with a summary containing `"prompt"` returns an `Err` and the error message names the offending marker.
- [x] `provider_runtime_static_guard_no_real_execution` (pre-existing, re-verified) — the file still contains no `ProviderPipeline`/`ProviderRegistry`/`OllamaRuntime`/socket/HTTP-call symbols anywhere, including the new doc comments added by this task (verified by deliberately rephrasing comments away from the literal string `ProviderPipeline` after the first attempt tripped this guard).

### `agent_runtime/runtime.rs`

- [x] `test_agent_runtime_provider_runtime_reflects_completion` — drives `execute_run` with a fake provider that completes; asserts `runtime.provider_runtime().get_execution(&format!("{run_id}-provider-exec"))` reaches `Completed` with `safe_summary == "provider_call_completed_via_bridge"`; asserts the serialized execution record contains no `prompt`/`raw_thinking`.
- [x] `test_agent_runtime_provider_runtime_reflects_failure` — drives `execute_run` with a fake `Unauthorized` provider error; asserts the execution reaches `Failed` with `safe_error_code == "provider_call_failed"` (the static code, not the raw `ProviderErrorKind` debug string).
- [x] `test_agent_runtime_provider_runtime_reflects_cancellation` — drives `execute_run` with a fake provider that emits `Cancelled`; asserts the execution reaches `Cancelled`.
- [x] All pre-existing `agent_runtime/runtime.rs` tests (lifecycle event order, legacy context consumption, cancellation race, error mapping, thinking privacy, step/event persistence) re-run unmodified and still pass — proves the bridge addition is purely additive metadata tracking with no change to the existing `AgentEvent` stream contract or terminal-state semantics.

### `api/orchestration.rs`

- [x] `main_generation_agent_run_shim_records_legacy_context_metadata_safely` (extended) — after the existing completed-path assertions, additionally asserts `shim.provider_runtime.get_execution(&shim.provider_execution_id)` reaches `Completed` with the bridge's safe summary.
- [x] `main_generation_agent_run_shim_mirrors_failed_generation` (extended) — after the existing failed-path assertions, additionally asserts the execution reaches `Failed` with `safe_error_code == "provider_call_failed"` even though the test passes `Some("provider_resolution_error")` as the AgentRun's own `error_kind` — proving the bridge never forwards the dynamic error_kind string into the marker-validated seam.
- [x] `main_generation_agent_run_shim_mirrors_cancelled_generation` (new) — drives the shim through a cancelled terminal transition; asserts the execution reaches `Cancelled`.
- [x] `test_product_paths_do_not_call_agent_runtime` (pre-existing, in `agent_runtime/service.rs`, re-verified) — `orchestration.rs` and `ask.rs` still contain none of `AgentRuntimeService`/`execute_run`/`agent_runtime()`; confirms the bridge was implemented without routing Main Generation through the full `AgentRuntime` execute-stream machine, preserving the existing shim boundary.

## Integration / Runtime Proof

- [x] Fresh debug service, isolated DB/config, real Ollama call through `/orchestration/execute`: `response.completed` SSE event observed; `agent_runs`/`agent_steps`/`agent_events` rows in the isolated SQLite DB confirm the run and its `provider_call` step both reached `completed` via the same `finish_main_generation_agent_run` function this task modified.
- [x] Packaged Electron sidecar binary: `/health` ready, fingerprint matches; safe lightweight smoke (create/list Loom) passes.

## Result

All test cases pass. 1014/1014 Rust tests, 559/559 frontend tests, full `./loom.sh --publish --test` pipeline, and `npm run electron:package:dev` all green.
