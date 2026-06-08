# Task: NATIVE-OPENAI-ADAPTER-001 (v1.0)

Checklist for implementing the native OpenAI provider adapter:

- [x] Extend `ProviderKind` and `ProviderTransportKind` enums in `providers/config.rs`
- [x] Add `openai_native_example()` to `ProviderProfileConfig`
- [x] Implement `openai.rs` containing `OpenAiRuntime`, `OpenAiProviderAdapter`, SSE parser, and error mapper
- [x] Register `openai` module in `providers/mod.rs`
- [x] Update `ProviderRegistry` to support `OpenAi` kind/adapter
- [x] Add matching match arms for `ProviderKind::OpenAi` in `api/capabilities.rs` and `api/model_runtime.rs`
- [x] Inject `openai-native` profile in `config.rs` from env variables (`LOOM_OPENAI_BASE_URL`, `LOOM_OPENAI_MODEL`, `LOOM_OPENAI_API_KEY`)
- [x] Implement unit tests in `openai.rs` and config tests
- [x] Run formatting and build checks (`cargo fmt`, `cargo check`, `cargo test`)
- [x] Verify LiteLLM sandbox and other providers still route correctly
