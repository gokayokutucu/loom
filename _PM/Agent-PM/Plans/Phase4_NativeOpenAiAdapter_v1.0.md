# Plan: Native OpenAI Provider Adapter (NATIVE-OPENAI-ADAPTER-001) (v1.0)

## Objective
Implement a native OpenAI provider adapter for text-generation and streaming workloads, using Loom's existing provider registry/pipeline contract.

## Scope
1. **Extend Provider Configurations**:
   - Add `OpenAi` variant to `ProviderKind` and `ProviderTransportKind` enums in `services/loom-service/src/providers/config.rs`.
   - Implement `openai_native_example()` under `ProviderProfileConfig` to provide a template configuration for native OpenAI.
2. **Implement Native OpenAI Adapter**:
   - Create `services/loom-service/src/providers/openai.rs` with `OpenAiRuntime`, `OpenAiProviderAdapter`, request mapping, error mapping, and streaming SSE parser.
   - Map `ProviderContractRequest` to OpenAI's native chat completion request.
   - Build Authorization header `Authorization: Bearer <api_key>` (ensuring the secret is never exposed in debug output).
   - Parse OpenAI's streaming chat completion SSE events (`data: {...}`, `data: [DONE]`).
   - Yield `ProviderContractEvent::Delta`, `Completed`, or `Error`.
3. **Registry and API Integration**:
   - Register the `openai` module in `services/loom-service/src/providers/mod.rs`.
   - Update `ProviderRegistry::new_for_profile` in `services/loom-service/src/providers/adapter.rs` to route `openai-native` profile to `OpenAiProviderAdapter`.
   - Update API match patterns in `services/loom-service/src/api/capabilities.rs` and `services/loom-service/src/api/model_runtime.rs` to support `ProviderKind::OpenAi`.
4. **Environment Variables**:
   - Read from `LOOM_OPENAI_BASE_URL` (default: `https://api.openai.com/v1`), `LOOM_OPENAI_MODEL` (default: `gpt-4o-mini`), and `LOOM_OPENAI_API_KEY`.
5. **Testing**:
   - Add comprehensive Rust unit tests covering request body mapping, authorization header construction, SSE delta/done parsing, error mapping, and registry selection.
