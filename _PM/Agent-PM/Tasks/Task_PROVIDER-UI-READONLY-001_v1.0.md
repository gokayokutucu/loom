# Task: PROVIDER-UI-READONLY-001 - Provider UI Readonly Status (v1.0)

Task ID: `PROVIDER-UI-READONLY-001`  
Goal: Add a read-only provider status section in the prompt composer's model picker menu using the `providerDiscovery` helper.

## Tasks
- [x] Update imports and state in `src/App.tsx` inside `PromptComposer` to support provider discovery.
- [x] Add `useEffect` to fetch and normalize provider statuses when the model picker menu is opened.
- [x] Add the presentational rendering logic for "Provider Status" inside the model picker popover.
- [x] Add CSS styling rules to the bottom of `src/styles.css`.
- [x] Run vitest unit tests: `npm run test:unit`.
- [x] Verify production build: `npm run build`.
- [x] Verify git checks: `git diff --check`.
