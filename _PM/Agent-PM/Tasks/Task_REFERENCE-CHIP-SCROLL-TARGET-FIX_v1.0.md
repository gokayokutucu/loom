# REFERENCE-CHIP-SCROLL-TARGET-FIX-001

## Objective

Fix reference chip navigation so exact response and fragment references never fall back to the latest/bottom response when the target is missing or not mounted yet.

## Checklist

- [x] Use audit findings from `REFERENCE-CHIP-SCROLL-TARGET-REGRESSION-AUDIT-001`.
- [x] Remove latest-response fallback for exact/origin pending reference scrolls.
- [x] Add explicit reference navigation guard against latest-turn/completion anchors.
- [x] Improve exact response target lookup.
- [x] Add targeted E2E regression coverage.
- [x] Run available validation.
