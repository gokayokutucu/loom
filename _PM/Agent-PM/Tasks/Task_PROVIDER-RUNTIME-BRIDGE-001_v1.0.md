# Task PROVIDER-RUNTIME-BRIDGE-001 v1.0

## Goal

Route Main Generation's AgentRun provider execution through `ProviderRuntimeService` instead of leaving it as an unwired, disconnected metadata seam. `AgentRuntime::execute_run` gets the same treatment for consistency, since both call sites called `ProviderPipeline::stream_chat` directly with no lifecycle seam in front of it.

## Checklist

- [x] Audit `docs/provider_runtime_seam_audit.md`, `docs/context_pipeline_flow_audit.md`, `docs/context_integration_spec_amendment.md`, `docs/loom_v1_v2_boundary_audit.md`, `docs/loom_v1_v2_codeboundary_marking.md`.
- [x] Confirm `ProviderRuntimeService` (`provider_runtime.rs`) is metadata-only by design and must never call a provider directly — verified by its own `provider_runtime_static_guard_no_real_execution` test, which forbids `ProviderPipeline`/`ProviderRegistry`/`OllamaRuntime`/socket symbols anywhere in the file (including comments).
- [x] Add `ProviderRuntimeService::complete_execution(execution_id, safe_summary)` — the existing `complete_noop` hardcodes a noop-only message; real provider calls need a generic-but-accurate completion path with a caller-supplied, marker-validated safe summary.
- [x] Wire `AgentRuntime` (`agent_runtime/runtime.rs`) to own a `ProviderRuntimeService` instance and drive its lifecycle (`submit_noop` → `transition_to_running` → `complete_execution`/`fail_execution`/`cancel_execution`) around its existing `pipeline.stream_chat` call, at every terminal branch (success, error, cancelled-via-event, cancelled-via-signal, stream-ended-without-terminal-event, and the post-loop race-condition check).
- [x] Wire Main Generation's `MainGenerationAgentRunShim` (`api/orchestration.rs`) the same way: register on `start_main_generation_agent_provider_step`, transition terminal state inside the single shared `finish_main_generation_agent_run` helper (which is already the one place all 7+ terminal call sites converge on).
- [x] Use only static, hand-picked safe codes (`provider_call_completed_via_bridge`, `provider_call_failed`, `provider_stream_ended_without_terminal_event`) at the bridge boundary — never pass a dynamic `error_kind`/`ProviderErrorKind` Debug string through, since several real variants (e.g. `MissingSecret`, `SecretUnavailable`) would collide with the seam's own forbidden-marker validator (`"secret"`) and silently fail to transition.
- [x] Add focused tests: 3 new tests in `agent_runtime/runtime.rs` (completion/failure/cancellation reflected in `provider_runtime()`), 2 new tests in `provider_runtime.rs` (`complete_execution` accept/reject paths), 1 new test in `api/orchestration.rs` (`main_generation_agent_run_shim_mirrors_cancelled_generation`), plus assertions added to the 2 existing Main Generation shim tests (completed/failed paths).
- [x] Run full validation suite.
- [x] Run fresh debug runtime verification with a real Ollama call through the bridged path.
- [x] Run Electron packaged sidecar verification.
- [x] Commit with `feat(provider-runtime): bridge main generation through provider runtime`.

## Scope Guard

- [x] No public API contract change — `/orchestration/execute` and `/ask/quick` request/response shapes are unchanged.
- [x] No frontend behavior change.
- [x] Quick Ask untouched — `api/ask.rs` was not modified; `test_product_paths_do_not_call_agent_runtime` (in `agent_runtime/service.rs`) still passes, confirming `ask.rs` and `orchestration.rs` still don't reference `AgentRuntimeService`/`execute_run`/`agent_runtime()`.
- [x] `ContextManager`/contributors untouched.
- [x] Attachment/capsule/Weft/Reference/memory behavior untouched.
- [x] No raw prompts/context/provider payloads/model output/thinking persisted — `ProviderRuntimeService` remains metadata-only; verified by its existing privacy tests plus the new tests' explicit forbidden-marker assertions.
- [x] No tools, MCP, or subagent work added.
- [x] Not pushed.

## Validation Evidence

- `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`: passed (after `cargo fmt` auto-applied formatting to the two edited Rust files; no logic change).
- `cargo check --manifest-path services/loom-service/Cargo.toml`: passed.
- `cargo test --manifest-path services/loom-service/Cargo.toml`: passed, 1014 tests (up from 1008 prior to this task's 6 new tests), 0 failed.
- `npm run service:check`: passed.
- `npm run service:test`: passed, 1014 tests.
- `npm run build`: passed.
- `npx vitest run`: passed, 559 tests (frontend untouched by this task).
- `git diff --check`: passed.
- `./loom.sh --publish --test`: passed (release Rust build, service test, frontend build, vitest, staged-diff whitespace check all green).
- `npm run electron:package:dev`: passed — packaged `dist-electron/Loom.app`.

## Runtime Verification

- Fresh debug binary built (`cargo build --manifest-path services/loom-service/Cargo.toml`), launched with isolated temp SQLite DB/config on an unused port via `LOOM_SERVICE_CONFIG_PATH`/`LOOM_SERVICE_PORT`/`LOOM_SERVICE_DB_PATH`. `/health` returned `status: ready`, `lifecycleState: ready`, `database.status: ready`, `buildProfile: debug`.
- Created a Loom, then `POST /orchestration/execute` with a short prompt against the locally available `llama3.2:latest` Ollama model. Stream produced `response.delta` then `response.completed` with `doneReason: stop`.
- Queried the isolated temp SQLite DB directly: the resulting `agent_runs` row reached `status = completed` with the correct `model_id`/token counts; its `provider_call` `agent_steps` row reached `status = completed`; the durable `agent_events` sequence was `run_created → run_queued → run_started → main_generation_context_built → run_completed` — confirming the bridged `finish_main_generation_agent_run` path (which now also drives `shim.provider_runtime.complete_execution(...)`) executed on a real, non-test request.
- `ProviderRuntimeService` itself is intentionally not exposed through any HTTP endpoint (metadata-only, in-memory, per-shim) — its terminal-state behavior on this exact real request is proven by code coverage (the bridge call sites are unconditional in `finish_main_generation_agent_run`/`execute_run`, and are directly asserted by the new unit tests using the same code paths against fake and real provider event shapes).
- Process stopped; port confirmed released; temp DB/config directory removed.

## Electron Packaged Verification

- Packaged `dist-electron/Loom.app` via `npm run electron:package:dev` (fresh release Rust binary + frontend build).
- Launched `Loom.app/Contents/Resources/loom-service/loom-service` directly with isolated temp DB/config on an unused port. `/health` returned `status: ready`, `buildProfile: release`; reported `binary_fingerprint` matched the independently computed `sha256` of the packaged binary.
- Ran a safe lightweight smoke (create Loom, list Looms) to confirm the packaged binary serves real requests.
- Process stopped; port confirmed released; temp directory removed.

## Commit

`feat(provider-runtime): bridge main generation through provider runtime` — see QA doc for hash. Not pushed.
