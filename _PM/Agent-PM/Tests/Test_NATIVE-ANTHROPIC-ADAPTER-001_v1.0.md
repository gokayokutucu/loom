# Test NATIVE-ANTHROPIC-ADAPTER-001 v1.0

## Purpose
Confirm the correctness of native Anthropic Messages API serialization, deserialization, SSE event mapping, and E2E contract compatibility validation.

## Test Matrix
| Case ID | Input | Target | Expected Output | Status |
| --- | --- | --- | --- | --- |
| UNIT-01 | Anthropic runtime initialization | Config validation | Correct base URL, defaults and secret reference loaded | PASSED |
| UNIT-02 | Chat request mapping | Request payload | Messages role mapped to user/assistant, system prompt placed at top-level | PASSED |
| UNIT-03 | SSE chunk parser | Stream delta event | Correctly parses `content_block_delta` and emits text delta | PASSED |
| UNIT-04 | SSE chunk parser | Stream usage event | Parses input/output tokens from `message_start` / `message_delta` | PASSED |
| UNIT-05 | Error classifier | Status code/message | Maps 401 to Unauthorized, 429 to RateLimited, etc. | PASSED |
| E2E-01 | Model picker selection | Provider list | "Anthropic Native" group exists, claude-3-5-sonnet-latest is selected | PASSED |
| E2E-02 | Streaming execution | Chat lane | SSE event stream successfully received, text delta rendered, usage saved | PASSED |

