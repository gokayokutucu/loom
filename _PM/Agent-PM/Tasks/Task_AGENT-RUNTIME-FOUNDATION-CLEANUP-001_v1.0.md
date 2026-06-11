# Task: AGENT-RUNTIME-FOUNDATION-CLEANUP-001 v1.0

- [x] Remove broad module-level `allow(unused_imports)` from `services/loom-service/src/agent_runtime/mod.rs` and clean up unused imports.
- [x] Narrow or justify module-level `allow(dead_code)` in `agent_runtime` mod to specific structs/functions.
- [x] Define `AgentRuntimeProviderOptions` struct in `services/loom-service/src/agent_runtime/types.rs`.
- [x] Add `provider_options` field of type `Option<AgentRuntimeProviderOptions>` to `AgentRuntimeRequest` in `types.rs`.
- [x] Update `services/loom-service/src/agent_runtime/runtime.rs` to extract `temperature` and `max_output_tokens` from `AgentRuntimeRequest` with defaults (0.7 temperature, 1024 max_tokens).
- [x] Update unit tests in `runtime.rs` to verify mapping of default and custom options.
- [x] Run formatting, check, and test validations.
- [x] Commit cleanup as `chore: clean up agent runtime foundation contract`.
- [x] Push clean commits to `origin feature/agent-runtime`.
