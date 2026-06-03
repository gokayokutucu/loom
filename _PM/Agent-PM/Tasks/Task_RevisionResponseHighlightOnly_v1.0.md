# Task List - Revision Paging Response Highlight Only Fix

- [x] Revert custom scroll alignment and composer focus from `handlePromptRevisionNavigate` in `src/App.tsx`
- [x] Restore `scrollIntoView` behavior setting to 'smooth' in `scrollElementIntoViewFromCurrent` in `src/App.tsx`
- [x] Remove `.revision-focus-highlight--user` from `user-turn` message class in `src/App.tsx`
- [x] Clean up unused highlight classes (`.revision-focus-highlight--prompt`, `.revision-focus-highlight--user`) from `src/styles.css`
- [x] Update E2E assertions in `e2e/prompt-edit.spec.ts` to expect only response highlights and no user highlights or composer focus
- [x] Run Vitest unit tests suite successfully
- [x] Run Playwright E2E tests successfully
- [x] Run production build check successfully
