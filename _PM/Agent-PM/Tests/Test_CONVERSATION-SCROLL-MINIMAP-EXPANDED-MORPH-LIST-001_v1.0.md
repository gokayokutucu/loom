# Test Checklist - Morphing List Variant for Expanded Minimap Outline v1.0

- [ ] Verify compilation with no errors: `npm run build`
- [ ] Assert `.conversation-minimap__ticks-container` opacity is `0` when hover outline is open.
- [ ] Assert `.conversation-minimap__ticks-container` opacity is `1` when hover outline is closed.
- [ ] Assert parent outline rows contain no `.conversation-minimap__outline-marker` elements.
- [ ] Assert child revision rows contain left-aligned `.conversation-minimap__outline-marker--revision` elements.
- [ ] Assert unit tests pass: `npx vitest run src/services/conversationMinimap.test.ts`
- [ ] Assert E2E tests pass: `env E2E_PORT=5196 npx playwright test e2e/conversation-minimap.spec.ts`
- [ ] Confirm no git check warnings: `git diff --check`
