# Task_CONVERSATION-SCROLL-MINIMAP-RULER-POLISH-002_v1.0

## Objective

Polish conversation minimap ruler tooltip, split visibility, right-side spacing, and hover bridge.

## Scope

- [ ] Add `title={item.label}` and `title={child.label}` attributes to the outline rows in `ConversationScrollMinimap.tsx` so native tooltips work.
- [ ] Add `showMinimap?: boolean` prop to `ChatTranscript` in `src/App.tsx`.
- [ ] Pass `showMinimap={false}` to the `weft-split-panel` transcript in `src/App.tsx`.
- [ ] Increase right padding of `.chat-transcript` by 10px in `src/styles.css`.
- [ ] Increase right padding of `.weft-panel .chat-transcript` by 10px in `src/styles.css`.
- [ ] Add transparent hover bridge (`::after` pseudo-element) on `.conversation-minimap__outline` in `src/styles.css`.
- [ ] Add E2E tests for split visibility (confirm minimap exists in origin panel but not in weft panel).
- [ ] Add E2E tests for tooltips (assert ticks and outline rows have the `title` attribute).
- [ ] Add E2E test for outline stability (hover first tick, move to outline card, confirm it remains visible and interactive).
- [ ] Run build, unit tests, and Playwright E2E tests.
