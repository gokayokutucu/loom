# Test: AGENT-RUNTIME-API-EXPERIMENTAL-ROUTE-001 v1.0

- [x] Gate default test: router built with default `ExperimentalApiConfig` returns 404 for `POST /experimental/agent/run` (route not mounted, handler never runs).
- [x] Gate enabled test: router built with `agent_runtime_api: true` mounts the route; invalid request returns 400.
- [x] Stream proof test: enabled route returns 200 with `application/x-ndjson`; body is line-delimited JSON starting with `run_started` and terminating with a terminal event (`run_failed` with unreachable provider), free of forbidden thinking/secret strings.
- [x] Validation tests: empty prompt, oversized prompt, NaN/out-of-range temperature, zero/over-cap maxOutputTokens all rejected with 400 + stable error codes.
- [x] DTO safety test: unknown fields (`authorization`, `apiKey`, `providerPayload`) fail deserialization via `deny_unknown_fields`.
- [x] Route privacy test: fake provider thinking events never appear in NDJSON output; run store holds no prompt text.
- [x] Provider options tests: absent options pass through as `None` (runtime owns defaults — no route literals); custom options map through (f64→f32, u64→u32).
- [x] Static guard: all `src/api` modules except `agent_experimental.rs`/`state.rs` are free of `agent_runtime()`, `AgentRuntimeService`, `execute_run`.
- [x] Note: route proven via Rust router/HTTP tests only — no browser/product proof needed (no frontend behavior changed).
