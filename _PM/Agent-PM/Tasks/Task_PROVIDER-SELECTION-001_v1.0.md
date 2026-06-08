# Task: PROVIDER-SELECTION-001 (v1.0)

Checklist for implementing grouped model picker:

- [x] Investigate flat model picker rendering and positioning logic in `src/App.tsx`
- [x] Define CSS classes for groups, titles, and badges in `src/styles.css`
- [x] Implement the grouped model picker rendering using `resolveModelSelection` and `discoveredProfiles`
- [x] Maintain selection state and map picker clicks to provider+model pairs via `setMainModel`
- [x] Update height positioning logic and layout dependency hooks in `PromptComposer`
- [x] Implement unit tests in `src/services/modelGrouping.test.ts`
- [x] Verify unit tests pass using `npm run test:unit`
- [x] Verify bundle builds cleanly using `npm run build`
- [x] Check formatting with `git diff --check`
- [x] Verify backward compatibility for flat Ollama list / mock fallback
