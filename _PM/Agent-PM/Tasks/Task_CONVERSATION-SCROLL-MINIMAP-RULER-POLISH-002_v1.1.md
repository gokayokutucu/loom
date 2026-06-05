# Task_CONVERSATION-SCROLL-MINIMAP-RULER-POLISH-002_v1.1

## Objective

Polish conversation minimap ruler tooltip, split visibility, right-side spacing, and hover bridge.

## Scope

- [x] Add `title={item.label}` and `title={child.label}` attributes to the outline rows in `ConversationScrollMinimap.tsx` so native tooltips work.
- [x] Add `showMinimap?: boolean` prop to `ChatTranscript` in `src/App.tsx` (default `true`).
- [x] Pass `showMinimap={false}` to the `weft-split-panel` transcript in `src/App.tsx`.
- [x] Compute `isMinimapActive = showMinimap && visible && measuredItems.length > 0` inside `ChatTranscript`.
- [x] Apply `.chat-transcript-shell--with-minimap` class to the shell when `isMinimapActive` is true.
- [x] Add `.chat-transcript-shell--with-minimap .chat-transcript` padding rule (+10px right) in `src/styles.css`.
- [x] Add `.weft-panel .chat-transcript-shell--with-minimap .chat-transcript` padding rule (+10px right) in `src/styles.css`.
- [x] Add transparent hover bridge (`::after` pseudo-element) on `.conversation-minimap__outline` in `src/styles.css`.
- [x] Add E2E tests for split visibility (confirm minimap exists in origin panel but not in weft panel).
- [x] Add E2E tests for tooltips (assert ticks and outline rows have the `title` attribute).
- [x] Add E2E test for hover bridge stability (hover tick, move to outline card, confirm it remains visible).
- [x] Run build, unit tests, and Playwright E2E tests.
