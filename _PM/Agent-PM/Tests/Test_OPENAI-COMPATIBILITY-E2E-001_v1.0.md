# Test OPENAI-COMPATIBILITY-E2E-001 v1.0

## Purpose
Confirm end-to-end integration of the native OpenAI adapter with the Electron application interface using a local OpenAI-compatible sandbox (Level 1 Validation).

## Test Matrix
| Case ID | Input | Target | Expected Output | Status |
| --- | --- | --- | --- | --- |
| E2E-01 | Model picker selection | Provider list | "OpenAI Native" group exists, gpt-4o-mini is selected | PASSED |
| E2E-02 | Send "Say hello in exactly two words" | Chat lane | Streaming starts, tokens render, completes normally | PASSED |
| E2E-03 | Log check | loom-service logs | Request sent to `/v1/chat/completions` on local port 4000 | PASSED |
