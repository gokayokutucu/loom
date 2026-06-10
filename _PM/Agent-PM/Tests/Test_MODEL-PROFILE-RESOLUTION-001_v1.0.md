# Test Plan: MODEL-PROFILE-RESOLUTION-001 (v1.0)

Verification of the model selection resolution helper:

- [x] Test Case 1: Legacy behavior (no provider profile specified)
  - Input: `selectedModelId: "qwen:7b"`, `selectedProviderProfileId: undefined`, `availableProfiles: [...]`
  - Output: `providerProfileId: undefined` (or resolved if unique), `modelId: "qwen:7b"`, `requestModel: "qwen:7b"`, `isAmbiguous: false`

- [x] Test Case 2: Selected provider + model resolves successfully
  - Input: `selectedModelId: "qwen:7b"`, `selectedProviderProfileId: "ollama-local"`, `availableProfiles: [...]`
  - Output: `providerProfileId: "ollama-local"`, `modelId: "qwen:7b"`, `requestModel: "qwen:7b"`, `isAmbiguous: false`, `warning: undefined`

- [x] Test Case 3: Missing model under selected provider gives warning
  - Input: `selectedModelId: "mistral:7b"`, `selectedProviderProfileId: "ollama-local"`, `availableProfiles: [ { id: "ollama-local", modelIds: ["qwen:7b"] } ]`
  - Output: `providerProfileId: "ollama-local"`, `modelId: "mistral:7b"`, `requestModel: "mistral:7b"`, `isAmbiguous: false`, `warning: "Model \"mistral:7b\" is not declared in provider profile \"ollama-local\"."`

- [x] Test Case 4: Same model exists under multiple providers (ambiguity check)
  - Input: `selectedModelId: "llama3.2"`, `selectedProviderProfileId: undefined`, `availableProfiles: [ { id: "ollama-local", modelIds: ["llama3.2"] }, { id: "litellm-sandbox", modelIds: ["llama3.2"] } ]`
  - Output: `providerProfileId: undefined`, `modelId: "llama3.2"`, `requestModel: "llama3.2"`, `isAmbiguous: true`, `warning: contains "ambiguous"`

- [x] Test Case 5: Unknown provider profile fallback
  - Input: `selectedModelId: "qwen:7b"`, `selectedProviderProfileId: "unknown-provider-id"`, `availableProfiles: [...]`
  - Output: Does not crash; `providerProfileId: undefined`, `modelId: "qwen:7b"`, `requestModel: "qwen:7b"`, `isAmbiguous: false`, `warning: contains "not found"`

- [x] Test Case 6: LiteLLM sandbox profile resolves without special casing
  - Input: `gpt-4o`, `litellm-sandbox`, availableProfiles
  - Output: resolves cleanly.
