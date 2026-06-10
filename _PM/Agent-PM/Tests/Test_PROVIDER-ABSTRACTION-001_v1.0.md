# Test Execution Plan: PROVIDER-ABSTRACTION-001 (v1.0)

Task ID: `PROVIDER-ABSTRACTION-001`  
Goal: Verify correctness of the frontend provider profile normalization helper.

## Test Checklist
- [x] Test Default Ollama Provider:
  - id = "ollama-local"
  - label = "Ollama Local"
  - kind = "ollama"
  - isDefault = true
  - isSandbox = false
  - endpoint = "http://127.0.0.1:11434"
- [x] Test LiteLLM Sandbox Provider:
  - id = "litellm-sandbox"
  - label = "LiteLLM Sandbox"
  - kind = "sandbox"
  - isDefault = false
  - isSandbox = true
  - endpoint = "http://127.0.0.1:4000/v1"
- [x] Test Custom / Unknown Provider:
  - maps unknown kind to "unknown" or "custom" safely
  - preserves custom fields
- [x] Test Availability mapping:
  - checks status === "ready" matches isAvailable = true
  - other statuses result in isAvailable = false
- [x] Test Model IDs aggregation:
  - extracts associated model asset IDs/names from `RuntimeModelItem[]` list matching by `providerProfileId`
  - falls back to `defaultModel` if no models list is provided
- [x] Test Secret Protection:
  - verify no API keys or secrets are exposed or mapped
