# Task: PROVIDER-PERSISTENCE-001 (v1.0)

Checklist for implementing provider persistence:

- [x] Investigate local storage read/write and merge settings flow in `src/services/modelProviders.ts`
- [x] Add `quickProviderProfileId` property to `ModelProfileSettings` interface
- [x] Update `mergeSettings` in `src/services/modelProviders.ts` to keep provider profiles optional
- [x] Implement `restoreModelSelection` helper in `src/services/modelSelectionResolver.ts`
- [x] Add unit tests for `restoreModelSelection` covering all requested test scenarios
- [x] Wire the startup/load restore hook `useEffect` in `LoomApp` inside `src/App.tsx`
- [x] Run unit tests with `npm run test:unit`
- [x] Run production build with `npm run build`
- [x] Check formatting with `git diff --check`
