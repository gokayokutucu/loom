# Task Checklist - Split Pane Return Control Leak Fix v1.0

- [x] Change `onReturnToOrigin={returnToOrigin}` to `onReturnToOrigin={undefined}` in the origin split panel `ChatTranscript` inside `src/App.tsx`.
- [x] Add Playwright E2E assertion to verify Return to Origin is not visible in `.origin-split-panel` but is visible in `.weft-split-panel`.
- [x] Run `npm run build` to verify TypeScript builds cleanly.
- [x] Run local Playwright E2E tests: `npx playwright test e2e/prompt-edit.spec.ts`.
- [x] Run `./loom.sh --test` to verify frontend tests.
