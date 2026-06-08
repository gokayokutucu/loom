# Test Plan: NATIVE-OPENAI-ADAPTER-001 (v1.0)

## Objective
Verify the correctness of the native OpenAI provider adapter request/response mapping, SSE stream parsing, error classification, and registry integration.

## Test Scenarios
- [x] Verify `ProviderKind::OpenAi` and `ProviderTransportKind::OpenAi` serialize/deserialize correctly.
- [x] Verify `openai_native_example()` generates a valid configuration profile.
- [x] Verify that request body mapping converts messages and options correctly to the OpenAI chat completions format.
- [x] Verify that authorization headers are constructed properly without leaking api keys in debug representation.
- [x] Verify that the SSE chunk parsing correctly yields text deltas and handles the `[DONE]` event.
- [x] Verify that OpenAI error payloads map correctly to Loom's `ProviderError` structures.
- [x] Verify that `ProviderRegistry` selects the native OpenAI adapter when profile is `openai-native`.
- [x] Verify that `litellm-sandbox` and default `ollama-local` behaviors are completely unaffected.
