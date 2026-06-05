# Test Checklist - Morphing List Variant for Expanded Minimap Outline v1.1

- [x] Verify build compilation: `npm run build`
- [x] Verify unit tests pass: `npx vitest run src/services/conversationMinimap.test.ts`
- [x] Verify Playwright E2E tests pass: `env E2E_PORT=5196 npx playwright test e2e/conversation-minimap.spec.ts`
- [x] Assert ticks container fades to opacity 0 on hover, and returns to opacity 1 when unhovered.
- [x] Assert parent rows show outline markers on the right-hand side of their labels in the expanded list.
- [x] Assert revision child rows show L-shaped branch markers on the left-hand side of their labels in the expanded list.
