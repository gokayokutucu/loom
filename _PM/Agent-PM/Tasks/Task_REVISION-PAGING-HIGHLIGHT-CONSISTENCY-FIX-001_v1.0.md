# Task: REVISION-PAGING-HIGHLIGHT-CONSISTENCY-FIX-001

## Checklist
- [x] Implement pending revision highlight state & refs in `App.tsx`
- [x] Update `handlePromptRevisionNavigate` to register pending highlights (even if child responses are not yet loaded)
- [x] Implement the `useEffect` reactive mounting check in `App.tsx` to apply highlight once DOM element is found
- [x] Verify unit tests in `src/services/revisionPaging.test.ts`
- [x] Add 3-revision E2E spec in `e2e/prompt-edit.spec.ts`
- [x] Run automated checks (`npm run build`, unit tests, playwright test)
