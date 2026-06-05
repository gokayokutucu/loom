# Phase 4 — Provider Runtime: Compact Minimap Ruler Window Animation
## Task: CONVERSATION-SCROLL-MINIMAP-RULER-WINDOW-ANIMATION-001

Animate compact ruler tick window when jumping to distant outline items.

### Objective
Improve the right-top conversation minimap ruler so that when a user clicks a distant item from the hover outline (or clicked ticks / scrolling shifts), the compact ruler visibly rolls/slides its visible tick window to the destination region instead of instantly snapping.

### Prerequisites
- Vite app runs, and CSS styles/components are in `src/styles.css` and `src/components/ConversationScrollMinimap.tsx`.
- Spacing is locked to 16px, ruler height to 240px, and ticks contain only response titles (no revisions).

### Technical Details
- Wrap the compact tick elements in an absolute-positioned `.conversation-minimap__ticks-container`.
- Keep track of `startIndex` of the visible tick window.
- Apply a transition on the `.conversation-minimap__ticks-container` when `startIndex` changes during an explicit jump, or even scrolling window shifts.
- Avoid over-animating/jitter during continuous manual scroll by using an `isExplicitJumpRef` lock or matching gesture listener (`wheel` / `touchstart`) to immediately clear the jump/lock state if manual scroll is detected.
- Implement the transition using CSS transform `translateY(...)` to shift the container by the difference in index, then transition it back to `0px` with CSS transitions, or translate it directly.
- Add CSS transition for transform in `src/styles.css`.
- Ensure active tick remains highlighted and visible.
