# Task: MODEL-PROFILE-RESOLUTION-001 (v1.0)

Checklist for implementing model selection resolution:

- [x] Investigate current model selection flow (dropdowns, selectors, storage, payload construction)
- [x] Create `src/services/modelSelectionResolver.ts` with types and `resolveModelSelection`
- [x] Implement `resolveModelSelection` logic matching all resolution rules
- [x] Create unit tests in `src/services/modelSelectionResolver.test.ts`
- [x] Wire the helper in `src/App.tsx` generation payload construction and add inline comments
- [x] Run `npm run test:unit` and verify all tests pass
- [x] Run `npm run build` and ensure compilation is successful
- [x] Check git diff formatting with `git diff --check`
- [x] Verify that no UI or persisted state changes are introduced
