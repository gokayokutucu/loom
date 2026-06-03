# REFERENCE-CHIP-SCROLL-TARGET-FIX-001 Test Plan

## Product/UI E2E

- [ ] Response reference chip scrolls to the exact referenced response. Test added; execution blocked.
- [ ] Latest/unrelated response is not aligned as the target after reference click. Test added; execution blocked.
- [ ] Fragment/code-block reference chip scrolls to the source response content.
- [ ] Missing exact target fails closed instead of jumping to latest/bottom when feasible.

## Validation

- [x] `npm run build` passes.
- [x] `npx vitest run` passes.
- [ ] Targeted Playwright reference/navigation spec passes. Blocked by sandbox `listen EPERM` and escalated run usage limit.
- [x] `git diff --check` passes.
