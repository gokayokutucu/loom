# Plan: Native Provider Contract Matrix (NATIVE-PROVIDER-CONTRACT-MATRIX-001) (v1.0)

## Objective
Create a comprehensive native provider contract matrix comparing OpenAI, Anthropic Claude, and Google Gemini APIs before implementing native adapters.

## Scope
1. **Research & Documentation**:
   - Compare Auth Headers, Request Endpoints, and Request Body Shape.
   - Compare Message/Content Structure, System Prompt Handling, and Streaming Format.
   - Compare Delta Event Shape, Tool/Function Calling, and Usage/Token Reporting.
   - Compare Error Shapes, Rate-Limit Headers, and Cancellation Behavior.
   - Provide minimal non-streaming and streaming curl examples for all three providers.
2. **Adapter Order Recommendation**:
   - Recommend and justify the implementation order:
     1. OpenAI native
     2. Anthropic native
     3. Gemini native
3. **Artifact Location**:
   - Create `docs/native_provider_contract_matrix.md` with the full matrix and recommendations.
