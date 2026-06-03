# Test: Highlight Regression - v1.0

## Scenario: Click Selected-Text Fragment Reference
Verify that clicking a selected-text fragment reference scrolls to it, applies the temporary highlight class `.reference-fragment-scroll-highlight`, and then clears the highlight class after the timeout.

### Verification Steps
- [x] Set up service test harness.
- [x] Create and select a fragment reference.
- [x] Click the reference chip (token).
- [x] Verify scroll aligns the target text block.
- [x] Verify `reference-fragment-scroll-highlight` class is present.
- [x] Verify `reference-fragment-scroll-highlight` class clears after the 1.8s timeout.
