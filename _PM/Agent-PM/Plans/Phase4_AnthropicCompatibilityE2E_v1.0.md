# Phase 4 - Anthropic E2E Compatibility Validation Plan (v1.0)

## Objective
Formalize and verify the Level 1 Contract Compatibility E2E validation for the native Anthropic Claude provider adapter (`anthropic-native` profile) using Loom's E2E test harness.

## Scope
1. **Validation Path**: Verify that generation requests targeting the `anthropic-native` provider profile route correctly into the `AnthropicProviderAdapter`, process through `AnthropicRuntime`, and communicate with a local fake Anthropic Messages SSE server.
2. **Scenarios**:
   - **Scenario A & B (Basic Streaming)**: Verify prompt execution, SSE text delta stream parsing, completion handling, usage token accounting, and SQLite persistence.
   - **Scenario C (Cancellation)**: Verify stream abort/cancellation behaves cleanly and closes the socket on the mock server.
   - **Scenario D, E, F (Retry/Regenerate & Settings)**: Verify prompt retry, response regeneration, and UI provider settings persistence.
   - **Scenario G (Error Mapping)**: Verify status code mapping (401 Unauthorized mapping, etc.) is safe and does not leak API keys in error payloads.
3. **Safety Verification**: Ensure the service compiles, backend cargo tests pass, frontend unit tests pass, and frontend production build succeeds without warnings.

## E2E Topology
```text
Loom UI
  → anthropic-native profile
      → AnthropicProviderAdapter (Rust backend)
          → AnthropicRuntime (Rust backend)
              → Fake Anthropic Messages Endpoint (HTTP/SSE local mock server)
                  → Streaming SSE responses returned to UI
```

## Technical Prerequisites
- Stale backend processes or Vite servers cleared (ports 5174 and 17633)
- Fresh backend binary compiled: `cargo build --manifest-path services/loom-service/Cargo.toml`
- Mock server `fakeAnthropicServer.ts` initialized dynamically by Playwright harness
