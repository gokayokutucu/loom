# Conversation Tree and Navigation Model

**Document Type**: Sidebar Tree, Lineage, and Navigation Semantics  
**Status**: Draft 1.0

---

## 1. Purpose

This document defines how Loom AI renders and navigates the conversation graph.

It answers:

- What is the sidebar actually showing?
- Why should it feel like a commit-flow?
- How do Back and Forward work?
- What is a navigation history entry?
- What is a window in Loom AI?

---

## 2. Core Thesis

The Loom AI sidebar should not behave like a plain file tree.
It should behave more like a **commit-flow / lineage navigator**.

That means the sidebar must express:

- progression
- branching
- forks
- object type distinctions
- relationships
- fast traversal

---

## 3. Sidebar as Conversation Tree

The sidebar should eventually support a **conversation tree / lineage view**.

It should be able to render:

- Conversations
- Threads / forked paths
- Bookmarked responses if surfaced there
- Object type markers
- Branch relationships

### Desired feel
Closer to:
- commit history
- git graph
- lineage map

Not closer to:
- file explorer
- folder tree
- kanban accordion

---

## 4. Node Types in the Tree

Suggested node types:

- `Conversation`
- `Response`
- `Thread/Fork`
- `Bookmark`
- `QuickQuestion` when promoted

### Rendering hint
Each node type should be visually distinguishable.
Type should not rely only on text labels; iconography and structural placement should help.

---

## 5. Thread / Fork in the Tree

When the user clicks the **Thread** action under a response:
- that response and its ancestry define a fork lineage
- a new path is created
- that path may become a new Conversation branch

User-facing:
- “Thread”

System-facing:
- fork / lineage branch

This is why a commit-flow metaphor works well.

---

## 6. Back / Forward Semantics

Back and Forward are not cosmetic.
They are browser-like navigation controls over Loom destinations.

A destination may be:

- a Conversation root
- a deep Response
- a Bookmark target
- a Graph node target
- a History entry target

### Rules

- Back moves to the previous visited destination
- Forward moves to the next visited destination
- if the user goes Back and then performs a brand-new navigation, the forward stack is cleared

This should behave like a browser, not like a simple tab switcher.

---

## 7. History Stack

Navigation history should be a real stack of visited destinations.

### What should create a history entry
- opening a Conversation
- opening a Bookmark
- selecting from Address Bar suggestions
- clicking a Graph node
- jumping from History
- opening a Thread/Fork target
- deep navigation to a Response/Q+A item

### What should not create noisy entries
- scrolling
- hover states
- tooltip open/close
- typing in the composer
- small temporary popovers

---

## 8. Right-click Back / Forward Menus

Right-click on **Back** should show:
- previous destinations

Right-click on **Forward** should show:
- forward destinations

Each item should show:
- title
- type
- optionally path/context

This makes navigation feel browser-grade.

---

## 9. Window Definitions

In Loom AI, a **Window** is a bounded projection over the graph.

It is not an owner.

### 9.1 ConversationWindow
Shows:
- the active Conversation
- its contained responses
- its local references

### 9.2 ThreadWindow
Shows:
- a lineage/fork path from a chosen response anchor

### 9.3 ReferenceWindow
Shows:
- reference relationships around a node
- what it points to
- what points to it

### 9.4 TimeWindow
Shows:
- nodes bounded by time rules
- recent activity
- sliding history ranges

### 9.5 ContextWindow
Shows:
- currently linked references in the composer
- active contextual working set

### Rule
A node may appear in many windows at once.
That is correct.

---

## 10. Graph View Relationship

Graph View is a secondary visualization mode.

It should:
- reflect the same underlying navigation graph
- allow node-based navigation
- participate in history
- not replace the primary browser-like workflow

Clicking a Graph node should create a normal navigation entry.

---

## 11. Grouping and Tab Groups

Conversation grouping in the sidebar may behave like browser tab groups.

A group is:
- a visual/organizational navigation grouping
- not a canonical graph owner

Group operations:
- create group
- add/remove conversation from group
- rename group
- ungroup

This is navigation organization, not graph truth.

---

## 12. New Conversation Draft and Navigation

A new conversation starts as a clean draft.

Rules:
- it should not materialize into the sidebar as a real conversation until first meaningful send
- it may still be treated as a temporary destination
- returning Back/Forward to a still-valid draft should restore it sensibly
- abandoned empty drafts should not create ghost nodes

---

## 13. Navigation Invariants

1. Sidebar tree expresses lineage and branch logic.
2. Back/Forward works across all major Loom destinations.
3. History is destination-based, not scroll-based.
4. Windows are projections, not owners.
5. Graph View and Sidebar must stay semantically consistent.

---

## 14. Summary

The navigation model of Loom AI should be:

- browser-like in control behavior
- commit-flow-like in lineage rendering
- graph-backed in semantics
- window-based in projection
- consistent across Sidebar, Address Bar, History, and Graph View

---

## 15. Address Resolver Integration

Navigation entries should store enough data to restore a resolved Loom destination:

- canonical object identity when available
- human-readable alias path for display
- optional window/view selector
- title and type snapshot for history readability

Back/Forward should navigate resolved destinations, not raw labels. If an alias is stale or a target becomes deleted/unreachable, the resolver must return an explicit broken state so navigation can show recovery UI instead of silently failing.

Window-specific navigation applies after object resolution. A `ReferenceWindow`, `TimeWindow`, `ContextWindow`, or `LoomWindow` is a projection over graph objects, not the owner of those objects.
