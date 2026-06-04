# Phase 4 — Provider Runtime: Compact Minimap Ruler Polish
## Task: CONVERSATION-SCROLL-MINIMAP-RULER-POLISH-002

Polish the compact conversation minimap ruler by ensuring native tooltips, hiding it in split panes, increasing right-side spacing, and adding a hover bridge.

### Changelog (v1.1)
- Scoped +10px right-side padding only to transcripts where the minimap is active by introducing `.chat-transcript-shell--with-minimap` class.
- Ensured weft/revision split pane spacing remains unchanged when minimap is disabled.
- Added explicit E2E tests for split pane visibility (`.origin-split-panel` has minimap, `.weft-split-panel` does not).
- Added explicit E2E tests for native tooltips on ticks and outline rows.
- Added explicit E2E tests for hover bridge stability.

### Objective
1. Ensure full-title native tooltips are visible on hover for ticks and outline rows.
2. Hide the compact ruler in split/weft/revision panes (only show it for the main Loom pane when split view is active).
3. Increase right-side spacing between transcript content and ruler by 10px, scoped to when the minimap is active.
4. Add an invisible hover bridge to prevent the outline card from closing prematurely when moving the cursor from the ruler to the card.

### Prerequisites
- Vite app runs, and CSS styles/components are in `src/styles.css`, `src/components/ConversationScrollMinimap.tsx`, and `src/App.tsx`.

### Technical Details
- **Tooltips**: Add `title` attribute containing the full label to outline rows (parent rows and revision child rows). Compact ticks already have `title={item.label}`.
- **Split Pane Visibility**: Add `showMinimap?: boolean` prop to `ChatTranscriptProps` (default `true`) and pass `showMinimap={false}` to the `weft-split-panel` transcript in `src/App.tsx`.
- **Scoped Right-side Spacing**:
  - Add `chat-transcript-shell--with-minimap` class to `.chat-transcript-shell` when `isMinimapActive` is true.
  - In `src/styles.css`, define `.chat-transcript-shell--with-minimap .chat-transcript` with `padding-right: max(74px, calc((100% - 820px) / 2 + 54px))`.
  - In `src/styles.css`, define `.weft-panel .chat-transcript-shell--with-minimap .chat-transcript` with `padding-right: 38px`.
- **Hover Bridge**: Add `.conversation-minimap__outline::after` pseudo-element with `pointer-events: auto`, `background: transparent`, `right: -30px`, `top: 0`, `bottom: 0`, and `width: 30px` to bridge the gap.
