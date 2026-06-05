# Task Checklist - Morphing List Variant for Expanded Minimap Outline v1.1

- [x] Add `<span aria-hidden="true" className={["conversation-minimap__outline-marker", `conversation-minimap__outline-marker--${item.type}`].join(" ")} />` after the label in parent buttons in `ConversationScrollMinimap.tsx`.
- [x] Add transition and default opacity to `.conversation-minimap__ticks-container` in `styles.css`.
- [x] Update hovered/focused minimap ticks container opacity to `0` in `styles.css`.
- [x] Update `.conversation-minimap__outline-row` padding and gap layout in `styles.css`.
- [x] Update `.conversation-minimap__outline-row--child` padding layout in `styles.css`.
- [x] Update `.conversation-minimap__outline-marker` styling and transitions in `styles.css` to match ruler ticks.
- [x] Add hover and active styles for `.conversation-minimap__outline-marker` and revision markers.
- [x] Verify clean compilation with `npm run build`.
- [x] Run unit tests: `npx vitest run src/services/conversationMinimap.test.ts`.
- [x] Run Playwright E2E tests: `env E2E_PORT=5196 npx playwright test e2e/conversation-minimap.spec.ts`.
- [x] Verify git diff status and perform local commit without pushing.
