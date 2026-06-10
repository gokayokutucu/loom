# Test NATIVE-GEMINI-ADAPTER-001 v1.0

## Purpose
Confirm correctness of native Google Gemini API serialization, deserialization, JSON streaming array chunk parsing, and Playwright contract compatibility E2E.

## Test Matrix
| Case ID | Input | Target | Expected Output | Status |
| --- | --- | --- | --- | --- |
| UNIT-01 | Gemini runtime initialization | Config validation | Correct base URL, defaults, and API key reference loaded | passed |
| UNIT-02 | Chat request mapping | Request payload | Messages role mapped to user/model, system prompt placed in `systemInstruction` | passed |
| UNIT-03 | JSON stream parser | Stateful stream delta event | Balanced-brace tokenizer parses chunked JSON array and emits text deltas | passed |
| UNIT-04 | JSON stream parser | Stream usage event | Parses input/output/total token counts from `usageMetadata` in final chunk | passed |
| UNIT-05 | Error classifier | Status code/message | Maps 400 to InvalidResponse, 429 to RateLimited, etc. | passed |
| UNIT-06 | Provider registry | Registry configuration | Correctly resolves and instantiates `GeminiProviderAdapter` from profile | passed |
| E2E-01 | Model picker selection | Provider list | "Gemini Native" group exists, gemini-1.5-flash is selected | passed |
| E2E-02 | Streaming execution | Chat lane | SSE/JSON chunks successfully received from fake server, delta rendered, usage saved | passed |
