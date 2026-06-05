# Phase 4 — Provider Runtime: Compact Minimap Ruler Polish
## Task: CONVERSATION-SCROLL-MINIMAP-RULER-POLISH-002

Polish the compact conversation minimap ruler by ensuring native tooltips, hiding it in split panes, increasing right-side spacing, and adding a hover bridge.

### Objective
1. Ensure full-title native tooltips are visible on hover for ticks and outline rows.
2. Hide the compact ruler in split/weft/revision panes (only show it for the main Loom pane when split view is active).
3. Increase right-side spacing between transcript content and ruler by 10px.
4. Add an invisible hover bridge to prevent the outline card from closing prematurely when moving the cursor from the ruler to the card.

### Prerequisites
- Vite app runs, and CSS styles/components are in `src/styles.css`, `src/components/ConversationScrollMinimap.tsx`, and `src/App.tsx`.

### Technical Details
- **Tooltips**: Add `title` attribute containing the full label to outline rows (parent rows and revision child rows). Compact ticks already have `title={item.label}`.
- **Split Pane Visibility**: Add `showMinimap?: boolean` prop to `ChatTranscriptProps` (default `true`) and pass `showMinimap={false}` to the `weft-split-panel` transcript in `src/App.tsx`.
- **Right-side Spacing**: Increase transcript right padding by 10px:
  - In `.chat-transcript`, change right padding from `max(64px, ...)` to `max(74px, ... + 54px)`.
  - In `.weft-panel .chat-transcript`, change from `padding-inline: 28px` to `padding-left: 28px; padding-right: 38px;`.
- **Hover Bridge**: Add `.conversation-minimap__outline::after` pseudo-element with `pointer-events: auto`, `background: transparent`, `right: -30px`, and `width: 30px` to bridge the gap.
