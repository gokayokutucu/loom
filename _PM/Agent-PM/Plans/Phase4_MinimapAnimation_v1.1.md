# Phase 4 — Provider Runtime: Compact Minimap Ruler Window Animation & Placement
## Task: CONVERSATION-SCROLL-MINIMAP-RULER-WINDOW-ANIMATION-001

Animate compact ruler tick window when jumping to distant outline items, and adjust placement to avoid kebab/action menu overlap.

### Changelog (v1.1)
- Added requirements for shifting compact ruler vertical placement to avoid kebab/action menu overlap.
- Added top offset custom property `--conversation-minimap-top-offset` (default to `68px`).
- Shifted the outline/card positioning to align with the ruler.
- Ensured kebab menu safety by using `pointer-events: none` on the container/track and `pointer-events: auto` on interactive children, and increasing tick hitboxes to `16px` to prevent hover flicker.
- Updated verification plan to include E2E assertions for minimap placement below the top action/kebab menu area.

### Objective
Improve the right-top conversation minimap ruler so that:
1. When a user clicks a distant item from the hover outline, the compact ruler visibly rolls/slides its visible tick window to the destination region instead of instantly snapping.
2. The compact ruler is shifted vertically lower to avoid overlapping with the top-right actions/kebab menu.

### Prerequisites
- Vite app runs, and CSS styles/components are in `src/styles.css` and `src/components/ConversationScrollMinimap.tsx`.
- Spacing is locked to 16px, ruler height to 240px, and ticks contain only response titles (no revisions).

### Technical Details
- Wrap the compact tick elements in an absolute-positioned `.conversation-minimap__ticks-container` inside the track.
- Apply a transition on the `.conversation-minimap__ticks-container` when `startIndex` changes during an explicit jump.
- Lock/unlock transitions during manual scroll using `isExplicitJumpRef` and gesture events (`wheel`, `touchstart`).
- Use CSS transform `translateY(...)` on the ticks container to animate the shift.
- Introduce CSS custom property `--conversation-minimap-top-offset` (set to `68px`) for `.conversation-minimap` positioning.
- Make the tick buttons `height: 16px` and `margin-top: -8px` with flexbox centering to eliminate gaps between tick hitboxes, allowing smooth hover without flickering.
- Set `pointer-events: none` on `.conversation-minimap` and `.conversation-minimap__track`, and `pointer-events: auto` on `.conversation-minimap__tick` and `.conversation-minimap__outline`.
- Ensure active tick remains highlighted and visible.
