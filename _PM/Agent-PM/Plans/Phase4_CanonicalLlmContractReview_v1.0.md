# Plan: Canonical LLM Contract Review (CANONICAL-LLM-CONTRACT-REVIEW-001) (v1.0)

## Objective
Perform an architectural review of the current `ProviderAdapter` and `ProviderPipeline` contracts to determine whether they are provider-agnostic enough to support native OpenAI, Anthropic, and Gemini adapters.

## Scope
1. **Codebase Investigation**:
   - Inspect `ProviderAdapter` trait, `ProviderRegistry`, and `ProviderPipeline` in `services/loom-service/src/providers/adapter.rs` and `services/loom-service/src/providers/pipeline.rs`.
   - Inspect the current streaming contract and events (such as `ProviderContractEvent`, delta events, completion events, usage reporting, errors, and cancellation/timeout handling) defined in `services/loom-service/src/providers/contract.rs` and `services/loom-service/src/providers/types.rs`.
   - Inspect tool calling capability support in the current contract.
2. **Analysis & Review**:
   - Evaluate whether OpenAI native, Anthropic native, and Gemini native can map to the current abstraction.
   - List any missing fields, events, or capabilities required for full native provider integration.
   - Formulate recommendations (A, B, or C) with technical rationales.
3. **Artifact Deliverable**:
   - Create `docs/canonical_llm_contract_review.md` compiling findings and recommendation.
