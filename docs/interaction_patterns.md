# Interaction Patterns

**Document Type**: Reusable Interaction Rules  
**Status**: Draft 1.0

---

## 1. Purpose

This document collects reusable interaction rules for Loom.

It covers:

- context menus
- tooltips
- Ask flow
- selection popovers
- bookmark card behavior
- icon picker
- archive/delete patterns
- tab group interactions

---

## 2. Tooltip Rules

Loom should use a reusable tooltip/hint system.

### Rule
When hovering over icon-only or ambiguous controls:
- show tooltip after ~1 second
- keep tooltip subtle, dark, and readable
- use the same pattern consistently across the app

Examples:
- Link
- Delete
- Bookmark
- move handle if needed
- icon picker controls

---

## 3. Context Menus

Context menus are a power-user layer.
They must not be the only way to access important actions.

### 3.1 Loom Context Menu
Suggested items:
- Open
- Pin / Unpin
- Rename
- Change Icon
- Bookmark
- Copy Loom Address
- Archive
- Delete

### 3.2 Response Context Menu
Suggested items:
- Ask
- Link
- Bookmark
- Copy Loom Address
- Copy as Loom Markdown
- Open in Graph View

### 3.3 Bookmark Context Menu
Suggested items:
- Open
- Link
- Rename
- Copy Loom Address
- Remove bookmark

### 3.4 Group Context Menu
Suggested items:
- Rename Group
- New Tab in Group
- Move Group to New Window
- Ungroup
- Delete Group

---

## 4. Ask Flow

### 4.1 Selection Popover
Selecting text in a response should first open a small anchored popover, not the full Ask popup immediately.

Popover actions:
- Ask to Loom
- Quick Question

### 4.2 Anchoring
The popover should have a visible pointer/triangle that visually connects it to the selected text.

### 4.3 Ask Popup
If the user chooses Ask to Loom:
- open Ask popup
- keep selection highlight active
- create selection-derived reference chip above the composer
- Ask popup should be draggable
- no Discard button if X already exists
- Esc should close it

---

## 5. Selection Highlight Lifecycle

While Ask flow is active:
- keep highlight visible

If Ask flow is cancelled:
- remove highlight
- remove attached selection-derived reference chip

No stale highlight may remain.

---

## 6. Bookmark Card Rules

Bookmark cards should have:

- left move handle
- centered content area
- title
- URL
- type label
- added time
- right vertical action rail

### Rules
- drag handle vertically centered
- title readable and editable
- URL readable and truncated gracefully
- added time aligned far right
- Link action always visible
- Edit should be in right-click context menu, not necessarily as a visible button
- Delete aligned at the top of the action rail

---

## 7. Icon Picker

Loom icons/favicons may be customized using a Bear-like picker.

### Behavior
- compact dark popover/modal
- searchable icon grid
- selected state visible
- Done / Cancel
- current icon shown
- icon persists per Loom

---

## 8. Archive / Delete

### Archive
- soft close / reversible
- similar to closing a browser tab

### Delete
- destructive
- requires confirmation
- warn that references may become unreachable

### Rule
Archive and Delete must never feel ambiguous.

---

## 9. Grouping Interaction

Dragging one Loom onto another may create or update a group.

Rules:
- ungrouped Loom dropped on ungrouped Loom creates a group
- ungrouped Loom dropped on grouped Loom joins that group
- grouped Loom dropped on ungrouped Loom does not create a group
- grouped Loom dropped outside any group leaves its group
- pinned Looms cannot be grouped until unpinned
- dragging a Loom into the composer creates a Link / Reference and never triggers grouping
- default group names like Group #1
- group rename from context menu
- grouping should feel browser-like, not kanban-like

---

## 10. Scroll and Transcript Behavior

The transcript should:
- fade/slip smoothly under the bottom composer area
- have a floating scroll-to-bottom button when not at the latest message
- show only scrollbar thumb when appropriate, not the full track/rail in the main Loom panel

---

## 11. Action Rows under Responses

Assistant responses may show a compact action row including:
- Copy
- Bookmark
- Linked state
- Kebab / More

The row should be subtle and premium, not noisy.

---

## 12. Invariants

1. Tooltips are consistent.
2. Context menus are power-user enhancements, not the only path.
3. Ask flow is explicit, anchored, and cancellable.
4. Archive/Delete meanings are always clear.
5. Bookmark cards and groups must feel browser-grade, not dashboard-grade.

---

## 13. Summary

Interaction patterns in Loom should feel:

- explicit
- lightweight
- browser-like
- premium
- consistent

The app should never feel like a pile of unrelated floating interactions.
It should feel like one coherent AI browser product.

---

## 14. Broken Reference and Ledger Interaction

Interactions that create, retire, or break graph identity should map to runtime ledger events when persisted.

Examples:

- Bookmark action: `bookmark_created`, `address_created`
- Alias changes: `alias_created`, `alias_updated`, `alias_retired`
- Weft action: `fork_created`
- Drag-to-link or `#` reference insertion: `reference_mention_created`
- Selection promotion: `fragment_created`
- Archive/delete: `object_archived`, `object_deleted`, and possibly `broken_reference_detected`

Broken references must surface explicitly. UI should not silently remove stale links, aliases, or reference mentions.
