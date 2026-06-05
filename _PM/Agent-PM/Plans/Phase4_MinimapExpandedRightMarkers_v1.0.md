# Phase 4 Implementation Plan - Minimap Expanded Right Markers Variant v1.0

Create a right-side marker variant for the expanded conversation minimap outline on a new branch `feature/scroll-minimap-expanded-right-markers`.

## Technical Scope

### 1. Component Order Modification
- **File**: [ConversationScrollMinimap.tsx](file:///Users/gokay/Documents/Workspace/LoomAI/src/components/ConversationScrollMinimap.tsx)
- **Change**: For parent response rows, render `<span className="conversation-minimap__outline-label">` before the `<span className="conversation-minimap__outline-marker">` element so that the marker naturally renders on the right side of the text in CSS grid.
- **Child Rows**: Keep the child revision marker `<span className="conversation-minimap__outline-marker conversation-minimap__outline-marker--revision">` before the label so the marker remains on the left side of the indented row.

### 2. Styling Modifications
- **File**: [styles.css](file:///Users/gokay/Documents/Workspace/LoomAI/src/styles.css)
- **Change**:
  - Update `.conversation-minimap__outline-row` to use `grid-template-columns: minmax(0, 1fr) 14px;` so the parent row columns are `[label] [marker]`.
  - Override `.conversation-minimap__outline-row--child` to use `grid-template-columns: 14px minmax(0, 1fr);` so child rows keep `[marker] [label]`.
  - Align parent row markers to the right edge by adding `justify-self: end;` to `.conversation-minimap__outline-marker`.
  - Refine `.conversation-minimap__outline-marker--revision` to render as a subtle branch hook (L-shape using `::before` and `::after` pseudo-elements) to communicate "branch/revision" visually without standard list bullet or box markers.

### 3. Tests
- Add E2E tests or assertions verifying that parent rows have right-side markers and child rows have left-side branch markers.
