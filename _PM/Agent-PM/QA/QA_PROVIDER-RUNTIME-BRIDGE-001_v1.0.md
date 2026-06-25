# QA PROVIDER-RUNTIME-BRIDGE-001 v1.0

## Architecture

- [x] `ProviderRuntimeService` remains a metadata-only seam — never performs provider I/O itself (enforced by its own `provider_runtime_static_guard_no_real_execution` static-source test, which scans for forbidden execution symbols including in comments).
- [x] `AgentRuntime::execute_run` and `MainGenerationAgentRunShim` (Main Generation) each own a `ProviderRuntimeService` instance and drive its lifecycle around their own real, unchanged `ProviderPipeline::stream_chat` call — the real call did not move.
- [x] Quick Ask (`api/ask.rs`) was not touched and still does not reference `AgentRuntimeService`, retrieval, or any context/memory repository.
- [x] `ContextManager`/contributors, attachment/capsule/Weft/Reference/memory repositories untouched.
- [x] The Main Generation V1 shim boundary is preserved — `orchestration.rs` still does not call `AgentRuntimeService::execute`/`execute_run`/`agent_runtime()` (re-verified by the pre-existing `test_product_paths_do_not_call_agent_runtime` guard).

## Privacy

- [x] No prompt, provider payload/envelope, raw output, token, secret, or raw-thinking content enters `ProviderRuntimeService` records — enforced by `FORBIDDEN_PROVIDER_RUNTIME_MARKERS` validation on every transition, including the new `complete_execution` method.
- [x] Bridge call sites pass only static, hand-picked safe codes (`provider_call_completed_via_bridge`, `provider_call_failed`, `provider_stream_ended_without_terminal_event`) — never the dynamic `ProviderErrorKind` debug string, which can itself contain marker collisions (e.g. `MissingSecret`, `SecretUnavailable` contain `"secret"`).
- [x] Existing `AgentEvent`/`AgentRun`/Context Snapshot privacy guarantees are unchanged — this task added a parallel metadata seam, not a new content path.

## Verification

- [x] Focused test suites pass: 2 new `provider_runtime.rs` tests, 3 new `agent_runtime/runtime.rs` tests, 1 new + 2 extended `api/orchestration.rs` tests.
- [x] Full Rust suite passes: 1014/1014 (`cargo test`, `npm run service:test`).
- [x] Full frontend suite passes: 559/559 (`npx vitest run`); `npm run build` passes.
- [x] `cargo fmt --check` and `git diff --check` pass.
- [x] `./loom.sh --publish --test` passes end to end (release Rust build, service tests, frontend build, vitest, staged-diff whitespace check).
- [x] Fresh debug service healthy on an isolated DB/config/port; a real Main Generation request through the bridged path (against locally available Ollama) reached `response.completed`, with the durable `agent_runs`/`agent_steps` rows confirming `completed` status for both the run and its `provider_call` step.
- [x] Packaged Electron sidecar binary healthy on an isolated DB/config/port; reported binary fingerprint matched the independently computed sha256 of the packaged binary; safe lightweight smoke passed.
- [x] Both verification processes were stopped, their ports confirmed released, and their temp directories removed.

## Scope Guard

- [x] No public API contract change.
- [x] No frontend behavior change.
- [x] No tools, MCP, or subagent work.
- [x] No raw content persisted anywhere in the new code paths.
- [x] Not pushed.
