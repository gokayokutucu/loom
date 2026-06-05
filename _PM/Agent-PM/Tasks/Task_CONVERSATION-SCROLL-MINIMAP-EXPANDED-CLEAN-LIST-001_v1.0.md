# Task Checklist - Clean List Variant for Expanded Minimap Outline v1.0

- [x] Create branch `feature/scroll-minimap-expanded-clean-list` from `feature/scroll-minimap` (already done).
- [x] Omit parent row marker elements in `ConversationScrollMinimap.tsx`.
- [x] Keep child row marker elements in `ConversationScrollMinimap.tsx` with `--revision` modifier.
- [x] Add Clean List styling in `styles.css` for parent rows, active state with left border accent, and child branch hooks.
- [x] Update E2E test assertions in `e2e/conversation-minimap.spec.ts` for Variant B.
- [x] Verify clean compilation with `npm run build`.
- [x] Run unit tests: `npx vitest run src/services/conversationMinimap.test.ts`.
- [x] Run E2E tests: `env E2E_PORT=5196 npx playwright test e2e/conversation-minimap.spec.ts`.
- [x] Verify git diff status and perform local commit without pushing.
