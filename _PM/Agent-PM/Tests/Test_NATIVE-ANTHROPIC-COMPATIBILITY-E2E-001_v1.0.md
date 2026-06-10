# Test NATIVE-ANTHROPIC-COMPATIBILITY-E2E-001 v1.0

## Purpose
Confirm Level 1 Contract Compatibility for the native Anthropic Claude provider adapter against a mock Messages SSE endpoint.

## Test Matrix
| Case ID | Input | Target | Expected Output | Status |
| --- | --- | --- | --- | --- |
| E2E-01 | Select Model button text | Model picker UI | Contains "Anthropic Native · claude-3-5-sonnet-latest" | PASSED |
| E2E-02 | Input prompt: `Anthropic Native E2E streaming proof` | Chat generation & SSE streaming | Streams text deltas, verifies custom auth headers on mock server, persists assistant response to SQLite | PASSED |
| E2E-03 | Click "Stop response" | Cancellation flow | Generation halts, UI returns to idle, socket connection on mock server is closed | PASSED |
| E2E-04 | Retry prompt edit & Regenerate | Prompt edit flow | Original message is edited, stale downstream assistant responses are soft-deleted, replacements stream successfully | PASSED |
| E2E-05 | Navigate settings | AI Provider Settings | Provider profile card `Anthropic Native` status displays "Saved" and "Selected (claude-3-5-sonnet-latest)" | PASSED |
| E2E-06 | Input prompt with error mode | API Error mapping | Surfaced cleanly as "Unauthorized", debug key credentials redacted, no leaks to UI console/body | PASSED |
