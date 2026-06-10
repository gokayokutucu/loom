# Test Plan: NATIVE-PROVIDER-CONTRACT-MATRIX-001 (v1.0)

## Objective
Verify the correctness, completeness, and formatting of the native provider contract matrix.

## Test Scenarios
- [x] Verify that `docs/native_provider_contract_matrix.md` contains sections for all requested details: auth headers, endpoints, body shapes, streaming delta events, tool call formats, usage info, rate limits, and curls.
- [x] Verify that curl examples strictly follow the official API specs (v1/chat/completions for OpenAI, v1/messages for Anthropic, and v1beta/models for Gemini Developer API).
- [x] Verify that the document compiles to valid Markdown and contains no broken internal links or formatting issues.
- [x] Verify that the adapter implementation order is clearly stated with rationales.
