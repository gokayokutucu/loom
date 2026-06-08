# Task: CANONICAL-LLM-CONTRACT-REVIEW-001 (v1.0)

Checklist for performing the architectural review of Loom's LLM contract:

- [x] Investigate the current `ProviderAdapter` and `ProviderPipeline` abstractions
- [x] Investigate the streaming event model (`ProviderContractEvent` and metadata)
- [x] Investigate tool/function calling support in the current abstraction
- [x] Evaluate provider response mapping behavior
- [x] Assess native adapter readiness for OpenAI, Anthropic, and Gemini
- [x] Formulate recommendation A, B, or C with justifications
- [x] Write and save `docs/canonical_llm_contract_review.md`
- [x] Run `git diff --check` to verify no formatting regressions
- [x] Output the final report and update the ledger block
