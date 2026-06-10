# Test Plan: PROVIDER-SELECTION-001 (v1.0)

Verification of grouped model picker list and selection logic:

- [x] Test Case 1: Model grouping by provider profile
  - Input: 4 provider profiles with modelIds
  - Output: 4 grouped headers with corresponding models mapped under each header.

- [x] Test Case 2: Duplicate model IDs resolution
  - Input: `llama3.2` present under both `ollama-local` and `litellm-sandbox` profiles
  - Output: Model ID is displayed under both groups; selection maps cleanly to the selected provider's profile.

- [x] Test Case 3: Selection persistence mapping
  - Input: Stored model ID (`gpt-4o`) only (legacy format)
  - Output: Auto-resolves to its unique provider profile (`openai`) when possible.

- [x] Test Case 4: LiteLLM Sandbox profile details
  - Output: Group includes `Sandbox` badge and displays models `gpt-4o-mini` and `llama3.2`.
