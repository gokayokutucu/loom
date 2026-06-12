# Phase 4 Implementation Plan - Minimap Expanded Clean List Variant v1.0

Create a clean navigation list variant for the expanded conversation minimap outline on a new branch `feature/scroll-minimap-expanded-clean-list`.

## Technical Scope

### 1. Component Markup Modification
- **File**: [ConversationScrollMinimap.tsx](../../src/components/ConversationScrollMinimap.tsx)
- **Change**: Omit rendering `<span className="conversation-minimap__outline-marker">` completely for parent response rows so there is no marker element in the DOM for them.
- **Child Rows**: Keep rendering `<span className="conversation-minimap__outline-marker conversation-minimap__outline-marker--revision">` before the label for revision child rows.

### 2. Styling Modifications
- **File**: [styles.css](../../src/styles.css)
- **Change**:
  - Update `.conversation-minimap__outline-row` to use `display: block;` (or a single-column layout) and slightly increase padding (`padding: 5px 10px;`) for a clean, text-only list feel.
  - Update `.conversation-minimap__outline-row--child` to override layout as `display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 8px; align-items: center;` to preserve left-side layout for indented child rows.
  - Style the active parent row `.conversation-minimap__outline-row--active` using a subtle row background, accent text color (`color: var(--loom-accent);`), and a clean left-edge indicator (`box-shadow: inset 2px 0 0 var(--loom-accent);`).
  - Redesign `.conversation-minimap__outline-marker--revision` as a subtle branch hook (L-shape connector) using `::before` and `::after` pseudo-elements.

### 3. Tests
- Add E2E assertions verifying that parent rows do not have `.conversation-minimap__outline-marker` elements, while revision child rows still have left-aligned branch markers.
