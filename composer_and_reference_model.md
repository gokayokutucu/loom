# Composer and Reference Model

**Document Type**: Composer State, References, and Editing Rules  
**Status**: Draft 1.0

---

## 1. Purpose

This document defines how the Loom AI composer works.

It covers:

- per-conversation composer state
- inline references
- selection-derived references
- `#` insertion trigger
- drag-to-link
- linked references management
- Undo / Redo
- new conversation drafts

---

## 2. Core Principle

The composer is not a plain text box.
It is a **rich composition surface**.

But it should still feel:
- chat-like
- lightweight
- predictable
- text-first

---

## 3. Composer State is Conversation-scoped

Each Conversation must have its own composer draft state.

Suggested draft state contains:
- prompt text
- inline references
- selection-derived reference chips
- linked references list
- badge count
- caret/selection state when useful
- Undo / Redo history

### Rule
No global shared input state across conversations.

---

## 4. New Conversation Draft

Clicking **New Conversation** should open a clean draft page.

Rules:
- the draft is empty
- it does not immediately materialize as a sidebar conversation item
- it becomes a real conversation only after first meaningful send
- empty abandoned drafts should not leave ghost tabs

### Empty-state composer
For an empty draft:
- composer may be centered
- after first send, composer becomes bottom-anchored

---

## 5. References Terminology

Recommended terminology:

- **Link** = the action
- **Reference** = the inserted object
- **Linked References** = the current list of attached/linked Loom objects
- **Suggested Reference** = AI-suggested but not yet accepted

---

## 6. `#` Trigger

Typing `#` in the composer should open an inline suggestion menu.

Suggestions should be grouped into:
- Conversations
- Looms
- Bookmarks

Behavior:
- filter live as the user types
- selecting one inserts a Reference into the text flow

---

## 7. Inline References

References inserted via `#` or drag-to-link should live inside the text flow.

Examples:
- normal sentence text
- inline blue reference token
- typing continues before/after naturally

### Rule
Inline references must behave like true embedded text entities, not detached floating pills.

---

## 8. Selection-derived References

When text is selected inside a response and the user chooses **Ask to Loom**:
- the selected content should become a **selection-derived Reference**
- it should first appear as a chip above the composer
- not as a normal inline token inside the text body

This creates a clear distinction:

- normal References: inside text flow
- selection-derived References: attached chip above the composer

---

## 9. Linked References Control

The linked-items control near the composer should be named:

**References**

This control opens a linked references panel/dropdown.

It should:
- show all currently linked references for the active conversation
- have a badge count
- support remove actions
- stay perfectly synchronized with the actual prompt state

---

## 10. Drag-to-Link

Users should be able to drag addressable Loom objects into the composer.

Valid drag sources include:
- Sidebar conversation item
- History item
- Address Bar compass/current destination
- Bookmark item

Drop result:
- create a Reference
- keep the source object where it is
- this is always a Link operation, not a move

---

## 11. Removing References

Removing a Reference from any surface must update all related surfaces.

If a reference is removed:
- remove from prompt state
- remove from linked references dropdown
- decrement badge count
- clear any stale UI state

Single-source-of-truth behavior is mandatory.

---

## 12. Undo / Redo

Undo / Redo must be composer-level and conversation-scoped.

It must cover:
- text insertion/deletion/replacement
- `#` reference insertion
- drag-and-drop reference insertion
- reference deletion
- reference repositioning
- linked references dropdown removals

### Rule
Text and references belong to the same editing history model.

---

## 13. History Coalescing

Undo steps should be grouped sensibly.

### Coalesce
- normal continuous typing

### Hard boundaries
- reference insertion
- reference deletion
- reference movement
- drag/drop reference operations
- linked-reference list structural changes
- paste / large replacement

This makes Undo feel editor-like rather than noisy.

---

## 14. Auto-scroll Rule

If the user is scrolled upward in the active conversation and starts typing in the composer:
- automatically scroll to the bottom

Reason:
typing means re-entering the active live conversation context.

---

## 15. Composer Controls

The composer may include:
- References control
- model dropdown
- attach button
- microphone
- send arrow button

### Rule
Controls should remain compact and consistent with a chat-first experience.

---

## 16. Invariants

1. Composer state is per-conversation.
2. References and text are edited in one coherent model.
3. Selection-derived references and inline references are distinct presentation modes.
4. Undo / Redo covers all meaningful composer mutations.
5. Drag-to-link is always a Link operation, not a move.

---

## 17. Summary

The Loom AI composer should behave like:

- a text-first editor
- with inline semantic references
- with selection-derived attached references
- with conversation-scoped drafts
- with synchronized linked-reference management
- with editor-grade Undo / Redo

---

## 18. Graph Persistence Alignment

Composer references map to graph persistence as `ReferenceMention` objects.

Rules:

- Inserting a Loom reference creates or updates a ReferenceMention use-instance.
- The target Conversation, Response, Bookmark, or Fragment is not cloned.
- Selection-derived reference chips may promote to Fragment objects when bookmarked or otherwise accepted.
- Removing a reference removes the use-instance from the active draft state and should emit a runtime ledger event when the change is durable.
- Address serialization should use the resolver contract from `loom_addressing_and_resolution_model.md`.
