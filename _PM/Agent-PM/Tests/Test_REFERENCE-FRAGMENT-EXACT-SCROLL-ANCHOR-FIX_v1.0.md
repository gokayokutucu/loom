# REFERENCE-FRAGMENT-EXACT-SCROLL-ANCHOR-FIX-001 Test Plan

Task ID: REFERENCE-FRAGMENT-EXACT-SCROLL-ANCHOR-FIX-001
Status: completed

Expected checks:
- [x] Unit/build check passes.
- [x] Full Vitest suite passes.
- [x] Product E2E uses a temp SQLite DB.
- [x] Product E2E starts `loom-service`.
- [x] Product E2E creates data through service/product flows.
- [x] Product E2E cleans temp files and DB.
- [x] Fragment Reference click scrolls selected text into view.
- [x] Response Reference click scrolls source Response top into view.
- [x] Missing fragment helper returns unresolved so App falls back to source Response top, not latest/bottom.
- [x] Validation commands complete or any blocker is reported.

Validation results:
- `npm run build` passed.
- `npx vitest run` passed, including `referenceFragmentScroll` helper coverage.
- `npx playwright test e2e/reference-display.spec.ts -g "sent response Reference chip scrolls|creates, reuses, renders, sends, suggests, graphs, and exports Fragment References"` passed after rerunning with local port binding approval.
- `git diff --check` passed.

Notes:
- Missing-fragment fallback is covered by helper/unit behavior plus the implementation path: unresolved fragment text falls through to source Response top alignment and explicit target miss fail-closes without latest/bottom fallback.
