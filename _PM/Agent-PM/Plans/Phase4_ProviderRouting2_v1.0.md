# Plan: Phase 4 Provider Routing 2 (PROVIDER-ROUTING-002) (v1.0)

## Objective
Make `providerProfileId` influence backend provider adapter selection during generation, while preserving legacy model-only routing behavior.

## Scope
1. **Provider Registry Helpers**:
   - In `services/loom-service/src/providers/adapter.rs`, add `new_for_ollama_profile` and `new_for_openai_profile` constructors to `ProviderRegistry`.
2. **Provider Routing Resolution**:
   - Implement `create_provider_pipeline_for_request` in `services/loom-service/src/api/orchestration.rs` to construct the pipeline for a requested `providerProfileId`.
   - If `provider_profile_id` is provided, find the profile in `LoomServiceConfig.providers.profiles`. If not found or disabled, return a clear error.
   - If `provider_profile_id` is absent, fall back to the existing `new_for_main_generation` behavior.
3. **Model Routing**:
   - If `provider_profile_id` is explicitly requested, route using the model specified in `execution_input.model`. Otherwise, preserve legacy model fallback resolution logic.
4. **Backend Unit Tests**:
   - Add unit tests verifying:
     - Legacy model-only request routes to default.
     - Valid `providerProfileId` routes to the matching adapter.
     - `litellm-sandbox` profile resolves to the OpenAI-compatible adapter.
     - Unknown `providerProfileId` returns a deterministic error.
