# Phase 4 Implementation Plan - Minimap Expanded Morph List Variant v1.0

Implement the morphing expanded ruler design directly on the `feature/scroll-minimap-expanded-clean-list` branch.

## Technical Scope

### 1. Style Modifications in styles.css
- **File**: [styles.css](file:///Users/gokay/Documents/Workspace/LoomAI/src/styles.css)
- **Changes**:
  - Add transition support to `.conversation-minimap__ticks-container` with opacity, matching the 150ms close delay of the outline.
  - Hide/fade `.conversation-minimap__ticks-container` on `.conversation-minimap` hover or focus-within by setting `opacity: 0` and `transition-delay: 0s`.
  - Position `.conversation-minimap__outline` to `right: -10px` relative to its parent `.conversation-minimap` container to make it flush with the right edge.
  - Set `display: none` on the hover bridge `.conversation-minimap__outline::after` as the expanded panel now covers the ticks area directly.

### 2. Testing
- **File**: [conversation-minimap.spec.ts](file:///Users/gokay/Documents/Workspace/LoomAI/e2e/conversation-minimap.spec.ts)
- **Changes**:
  - Assert that when the outline is open, the ticks container has `opacity: 0`.
  - Assert that when the outline is closed, the ticks container has `opacity: 1`.
