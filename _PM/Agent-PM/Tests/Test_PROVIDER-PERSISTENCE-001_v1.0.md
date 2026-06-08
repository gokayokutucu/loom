# Test Plan: PROVIDER-PERSISTENCE-001 (v1.0)

Verification of provider selection restore and persistence logic:

- [x] Test Case 1: Legacy Restore (only model ID present)
  - Input: `selectedModelId: "gpt-4o"`, `selectedProviderProfileId: undefined`
  - Output: Auto-resolves `providerProfileId` to the matching profile (`openai` / `litellm-sandbox` depending on availability).

- [x] Test Case 2: Exact Restore (profile and model present and matching)
  - Input: `selectedModelId: "qwen:7b"`, `selectedProviderProfileId: "ollama-local"`
  - Output: Restores the exact pair cleanly.

- [x] Test Case 3: Missing Provider Fallback
  - Input: `selectedModelId: "llama3.2"`, `selectedProviderProfileId: "nonexistent-provider"`
  - Output: Provider does not exist, so it auto-resolves to matching active profile(s) (delegates to `resolveModelSelection`).

- [x] Test Case 4: Duplicate Model Restore
  - Input: `selectedModelId: "llama3.2"`, `selectedProviderProfileId: undefined`
  - Output: Model exists under multiple profiles, resolves to undefined profile with ambiguity flag set.

- [x] Test Case 5: LiteLLM Sandbox Restore
  - Input: `selectedModelId: "gpt-4o-mini"`, `selectedProviderProfileId: "litellm-sandbox"`
  - Output: Restores the sandbox pair correctly.
