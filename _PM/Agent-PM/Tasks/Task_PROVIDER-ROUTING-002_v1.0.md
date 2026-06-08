# Task: PROVIDER-ROUTING-002 (v1.0)

Checklist for implementing backend provider routing:

- [x] Investigate current backend provider selection path in `services/loom-service/src/providers/adapter.rs`
- [x] Add `new_for_ollama_profile` and `new_for_openai_profile` to `ProviderRegistry` in `services/loom-service/src/providers/adapter.rs`
- [x] Implement `create_provider_pipeline_for_request` in `services/loom-service/src/api/orchestration.rs`
- [x] Wire pipeline resolution and model selection logic in `execute_stream` inside `orchestration.rs`
- [x] Add Rust tests for legacy routing, valid routing, litellm-sandbox routing, and unknown profile error in `orchestration.rs`
- [x] Run cargo test and cargo check to verify compilation and tests pass
- [x] Run `npm run service:check` and `npm run service:test`
- [x] Verify production build compiles with `npm run build`
- [x] Check formatting with `git diff --check`
