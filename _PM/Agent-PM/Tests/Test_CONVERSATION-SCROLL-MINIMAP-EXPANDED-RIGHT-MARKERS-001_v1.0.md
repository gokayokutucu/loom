# Test Checklist - Expanded Minimap Right Markers Variant v1.0

- [x] Verify build compilation: `npm run build`
- [x] Verify unit tests pass: `npx vitest run src/services/conversationMinimap.test.ts`
- [x] Verify E2E tests pass: `npx playwright test e2e/conversation-minimap.spec.ts`
- [x] Assert parent outline row has a right-side marker and no left-side marker.
- [x] Assert revision child rows have indented left-side branch markers.
