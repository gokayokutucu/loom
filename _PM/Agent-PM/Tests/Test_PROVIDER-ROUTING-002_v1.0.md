# Test Plan: PROVIDER-ROUTING-002 (v1.0)

## Objective
Verify that `providerProfileId` influences backend provider adapter selection during generation, while preserving legacy model-only routing behavior.

## Test Scenarios

### 1. Legacy Model-Only Routing
- **Input**: `OrchestrationExecuteInput` with `provider_profile_id = None`.
- **Expected Output**: Selection falls back to legacy/default routing (e.g. `ollama-local` default adapter).
- **Checklist**:
  - [x] Legacy model-only request routes as before without errors.

### 2. Valid `providerProfileId` Routing (Ollama)
- **Input**: `OrchestrationExecuteInput` with `provider_profile_id = Some("ollama-local")`.
- **Expected Output**: Matches the local Ollama adapter.
- **Checklist**:
  - [x] Request selects `ollama-local` adapter.

### 3. Valid `providerProfileId` Routing (OpenAI-compatible)
- **Input**: `OrchestrationExecuteInput` with `provider_profile_id = Some("litellm-sandbox")`.
- **Expected Output**: Resolves to the OpenAI-compatible adapter configured for LiteLLM sandbox.
- **Checklist**:
  - [x] Request selects `litellm-sandbox` profile and targets OpenAI-compatible adapter.

### 4. Unknown/Invalid `providerProfileId` Handling
- **Input**: `OrchestrationExecuteInput` with `provider_profile_id = Some("invalid-profile")`.
- **Expected Output**: Returns a deterministic error (`provider_resolution_error`).
- **Checklist**:
  - [x] Unknown profile returns `provider_resolution_error` SSE event.

### 5. Regenerate/Retry Routing
- **Input**: `RegenerateResponseInput` or `RetryResponseInput` carrying `provider_profile_id`.
- **Expected Output**: Propagated to the execution request and routes correctly.
- **Checklist**:
  - [x] `providerProfileId` is preserved and used during retry/regeneration.
