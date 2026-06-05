# Task Checklist - Expanded Minimap Right Markers Variant v1.0

- [x] Reorder parent outline row children in `ConversationScrollMinimap.tsx` to place label before marker.
- [x] Update `.conversation-minimap__outline-row` grid-template-columns to `minmax(0, 1fr) 14px` and add `justify-self: end` to `.conversation-minimap__outline-marker` in `styles.css`.
- [x] Add `grid-template-columns: 14px minmax(0, 1fr)` to `.conversation-minimap__outline-row--child` in `styles.css`.
- [x] Redesign `.conversation-minimap__outline-marker--revision` as a subtle L-shape branch hook in `styles.css`.
- [x] Run `npm run build` to verify clean compilation.
- [x] Run Playwright E2E tests: `npx playwright test e2e/conversation-minimap.spec.ts`.
- [x] Verify git checks run cleanly: `git diff --check`.
