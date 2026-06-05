# Test Checklist - Clean List Variant for Expanded Minimap Outline v1.0

- [x] Verify compilation with no errors: `npm run build`
- [x] Assert parent outline rows do NOT contain `.conversation-minimap__outline-marker` elements.
- [x] Assert child revision rows contain left-aligned `.conversation-minimap__outline-marker--revision` elements.
- [x] Verify that parent row click scrolls same-pane to the target response/user-message anchor.
- [x] Verify that revision row click opens/focuses the revision split pane.
- [x] Assert unit tests pass: `npx vitest run src/services/conversationMinimap.test.ts`
- [x] Assert E2E tests pass: `env E2E_PORT=5196 npx playwright test e2e/conversation-minimap.spec.ts`
- [x] Confirm no git check warnings and workspace cleanliness checks pass: `git diff --check`
