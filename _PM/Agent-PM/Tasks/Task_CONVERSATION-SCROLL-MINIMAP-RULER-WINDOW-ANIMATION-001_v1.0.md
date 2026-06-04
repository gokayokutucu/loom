# Task_CONVERSATION-SCROLL-MINIMAP-RULER-WINDOW-ANIMATION-001_v1.0

## Objective

Animate compact ruler tick window when jumping to distant outline items.

## Scope

- [x] Audit existing minimap mount, geometry, item list, and scroll synchronization.
- [x] Wrap the tick elements in `ConversationScrollMinimap.tsx` inside a dedicated `.conversation-minimap__ticks-container`.
- [x] Add `.conversation-minimap__ticks-container` and transition classes (with `220ms ease-out` and prefers-reduced-motion media query) to `src/styles.css`.
- [x] Track the visible window's `startIndex` (e.g. from `visibleMinimapRulerWindow`).
- [x] Detect transition shifts and use inline CSS transform to animate the `.conversation-minimap__ticks-container`.
- [x] Lock/unlock transitions to explicit jumps vs continuous scrolls using `isExplicitJumpRef` and gesture events (`wheel`, `touchstart`).
- [x] Maintain fixed 16px tick spacing and fixed 240px ruler height.
- [x] Keep active tick visible and highlighted inside the visible window.
- [x] Ensure outline card behaves normally (scrolls internally, hides scrollbars, lists all response titles with indented revision child rows).
- [x] Run build, unit tests (`conversationMinimap.test.ts`), and Playwright E2E tests (`conversation-minimap.spec.ts`).
- [x] Verify transition visually via manual smoke test.
