# Quick Ask Trace Log Inspection

Task ID: QUICK-ASK-TRACE-LOG-INSPECTION-001

## 1. Failing Case Summary

Observed in the real local UI at `http://127.0.0.1:5173/`.

| Field | Value |
|---|---|
| Source title | Event Souricng nedır |
| Visible chip | Time Travel |
| User question | nasıl kullanılıyor? bu ne demek |
| Expected semantic task | Event Sourcing bağlamında Time Travel ne anlama gelir ve nasıl kullanılır? |
| Actual answer | Generic Event Sourcing usage answer; it explains Event Sourcing broadly and does not answer Time Travel directly. |

No product behavior fix was applied in this inspection task.

## 2. Collected Trace Table

Collected from the visible Quick Ask debug panel and browser console logs.

| Trace field | Observed value | Inspection result |
|---|---|---|
| traceId | `quick-ask-1778762899794-1` | Present in UI debug state. |
| visibleChipLabels | `Time Travel` | Present. |
| userQuestion | `nasıl kullanılıyor? bu ne demek` | Present. |
| selectedFragment | `Time Travel` | Present. |
| sourceTitle | `Event Souricng nedır` | Present. |
| inputActiveRefs | `Time Travel` | Present. |
| serviceActiveRefs | not rendered | Not proven from UI. |
| focusSubject | not rendered | Not proven from UI. |
| focusSubjectSource | not rendered | Not proven from UI. |
| resolvedIntent | not rendered | Not proven from UI. |
| requestedTopic | not rendered | Not proven from UI. |
| composedTask | not rendered | Not proven from UI. |
| promptSectionOrder | not rendered | Not proven from UI. |
| providerRequestSummary | not rendered | Not proven from UI. |
| answerValidation | `includesFocusSubject=n/a`, `includesRequestedTopic=n/a`, `genericSourceOnlyDetected=n/a` | Missing/empty diagnostics in UI. |
| browser console quick_ask logs | none found | Console only showed Vite/React startup logs. |
| network POST `/ask/quick` | not available for the already-completed request | The browser network buffer available to Codex did not include the prior POST body/response. |

## 3. Expected vs Actual Trace

| Hop | Expected passing trace | Actual trace |
|---|---|---|
| Visible chip -> UI state | `Time Travel` visible and recorded | Pass: visible chip recorded. |
| UI state -> QuickAskInput | `activeReferences` contains `Time Travel` | Pass from debug panel: input active refs contains `Time Travel`. |
| QuickAskInput -> HTTP body | POST `/ask/quick` body contains `activeReferences[0].label = Time Travel` | Not proven from current trace. |
| HTTP body -> service DTO | Service diagnostics contains `serviceActiveReferenceLabels = Time Travel` | Not proven; service fields absent in UI. |
| Service focus resolver | `focusSubject = Time Travel`, source `selected_fragment` or `active_reference` | Not proven; field absent. |
| Topic resolver | `requestedTopic = Event Sourcing` | Not proven; field absent. |
| Composed task | Includes `Event Sourcing`, `Time Travel`, and the user question intent | Not proven; field absent. |
| Prompt/provider summary | Focus before source body | Not proven; field absent. |
| Answer validation | Bad answer should show `includesFocusSubject=false`, `genericSourceOnlyDetected=true` | Failed observability: values are `n/a`. |
| UI result handling | If validation fails, UI should at least expose the failed validation in debug | Failed observability: UI shows normal answer with no validation data. |

## 4. Failure Classification

Primary classification: **M. unknown_needs_more_instrumentation**

Reason: the real UI trace proves the chip reaches the visible UI state and the optimistic QuickAskInput debug state, but the trace does not prove the HTTP body, service DTO, focus resolver, composed task, provider summary, or answer validation. The missing service diagnostics prevent a precise classification among `C` through `K`.

Secondary classification: **J. answer_validation_missing_or_wrong**

Reason: the visible debug panel reports `n/a` for answer validation even though the answer is visibly generic source-topic output and omits the focus subject `Time Travel`.

Secondary classification: **K. validation_failed_but_ui_showed_success** is not proven. It would apply only if service diagnostics show validation failed while the UI still treats the answer as normal success.

## 5. Root-Cause Hypothesis

The observable broken hop is:

```text
QuickAskInput debug state
-> service/HTTP diagnostics
-> UI debug panel enrichment
```

The likely causes are one of:

1. The real UI request did not use the rust-service `/ask/quick` path for this turn.
2. The HTTP request used `/ask/quick`, but the response diagnostics were not returned, parsed, or stored into the latest Ask exchange.
3. The service returned diagnostics, but the UI did not attach them to `debugTrace.diagnostics`.
4. The request occurred before network/console tracing was attached, so the current debug panel is the only available evidence.

No prompt or focus resolver fix should be attempted until the next task proves which of these is true.

## 6. Recommended Next Fix Task

Task ID: `QUICK-ASK-TRACE-TRANSPORT-PROOF-002`

Goal: prove the transport hop for the real UI path before changing prompt behavior.

Status: implemented as a transport-proof instrumentation pass. The debug panel now separates UI-only state from service-proven diagnostics by showing engine mode, client kind, request attempted, endpoint, HTTP status, parse status, diagnostics received, service active refs, focus/composed-task/provider summary, and answer validation. Missing service diagnostics are shown as explicit warnings instead of silently rendering `n/a`.

Required acceptance criteria:

- The Quick Ask debug panel shows `runtimePath = rust-service` or `typescript-local`.
- The debug panel shows whether a POST `/ask/quick` was attempted.
- The debug panel shows a safe HTTP status for the Quick Ask request.
- The debug panel shows `diagnosticsReceived = true/false`.
- The debug panel shows `serviceActiveReferenceLabels` when service diagnostics exist.
- If diagnostics are missing from a service response, the UI displays `diagnostics_missing_from_service_response`.
- If the real path is TypeScript local, the UI displays `legacy_typescript_local_quick_ask_path` in debug mode.
- Network/request proof must remain raw-thinking-safe and must not expose provider secrets or hidden prompts.

Only after that proof should a follow-up fix alter focus resolution, prompt ordering, or answer validation behavior.

## 7. Raw-Thinking Privacy Confirmation

The collected inspection data included only visible UI labels, the user-entered Quick Ask question, source title, debug booleans/labels, and browser console metadata. It did not collect or document:

- `raw_thinking`
- `thinking_text`
- `chain_of_thought`
- `hidden_reasoning`
- provider secrets
- raw provider payloads
- full hidden prompts
