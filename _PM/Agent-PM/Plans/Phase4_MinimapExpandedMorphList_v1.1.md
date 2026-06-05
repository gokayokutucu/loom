# Phase 4 Implementation Plan - Minimap Expanded Morph List Variant v1.1

Implement the morphing expanded ruler design directly on the `feature/scroll-minimap-expanded-clean-list` branch, ensuring ruler ticks are correctly positioned on the right of parent items inside the expanded box and scroll with them.

## Changelog from v1.0
- Instead of keeping the static `.conversation-minimap__ticks-container` visible on top of the outline, hide/fade it on hover/focus-within (`opacity: 0`).
- Render right-side `.conversation-minimap__outline-marker` lines inside the parent items inside the expanded box so they align properly and scroll with the items.
- Remove redundant 28px right padding from expanded item buttons.

## Technical Scope

### 1. Component Modifications
- **File**: [ConversationScrollMinimap.tsx](file:///Users/gokay/Documents/Workspace/LoomAI/src/components/ConversationScrollMinimap.tsx)
- **Changes**:
  - Re-add the `<span aria-hidden="true" className={["conversation-minimap__outline-marker", `conversation-minimap__outline-marker--${item.type}`].join(" ")} />` element to the parent `.conversation-minimap__outline-row` button, placing it *after* the label span.

### 2. Style Modifications in styles.css
- **File**: [styles.css](file:///Users/gokay/Documents/Workspace/LoomAI/src/styles.css)
- **Changes**:
  - Add transition support (`opacity 140ms ease 150ms`) and `opacity: 1` to `.conversation-minimap__ticks-container`.
  - Set `opacity: 0` and `transition-delay: 0s` on `.conversation-minimap__ticks-container` when `.conversation-minimap` is hovered or focused-within.
  - Position `.conversation-minimap__outline` to `right: 6px` relative to its parent `.conversation-minimap` container.
  - Set `display: none` on the hover bridge `.conversation-minimap__outline::after`.
  - Update `.conversation-minimap__outline-row` to use `display: flex; align-items: center; gap: 8px; padding: 5px 10px;`.
  - Update `.conversation-minimap__outline-row--child` to use `padding: 4px 7px;` right padding.
  - Style `.conversation-minimap__outline-marker` to match the compact ruler ticks (width 11px, height 2px, user type width 7px).
  - Add hover styles for `.conversation-minimap__outline-row:hover .conversation-minimap__outline-marker` to animate width to 20px.
  - Add active styles for `.conversation-minimap__outline-row--active .conversation-minimap__outline-marker` to animate width to 22px and height to 3px.
  - Add active styles for revision markers to highlight the L-shaped hook to accent color.

### 3. Testing
- **File**: [conversation-minimap.spec.ts](file:///Users/gokay/Documents/Workspace/LoomAI/e2e/conversation-minimap.spec.ts)
- **Changes**:
  - Assert that when the outline is open, the ticks container has `opacity: 0`.
  - Assert that when the outline is closed, the ticks container has `opacity: 1`.
