# Task Checklist - Morphing List Variant for Expanded Minimap Outline v1.0

- [x] Transition opacity on `.conversation-minimap__ticks-container` with delayed fade-in.
- [x] Set `opacity: 0` on `.conversation-minimap__ticks-container` when minimap is hovered or focused.
- [x] Move `.conversation-minimap__outline` right offset to `-10px` to cover the ticks rail.
- [x] Disable the redundant hover bridge `.conversation-minimap__outline::after`.
- [x] Add Playwright E2E assertions for ticks container opacity states (open vs closed).
- [x] Verify clean compilation with `npm run build`.
- [x] Run unit tests: `npx vitest run src/services/conversationMinimap.test.ts`.
- [ ] Run Playwright E2E tests: `env E2E_PORT=5196 npx playwright test e2e/conversation-minimap.spec.ts`.
- [ ] Verify git diff status and perform local commit without pushing.
