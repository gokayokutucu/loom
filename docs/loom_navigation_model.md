# Loom Navigation Model

**Document Type**: Browser, Weft, and Navigation Semantics  
**Status**: Draft 1.0

---

## 1. Purpose

This document defines how Loom AI navigates Looms, Responses, Bookmarks, Wefts, and graph projections.

It answers:

- how Back and Forward work
- what a navigation destination contains
- how Weft transitions behave
- how split/full Weft layout is selected
- how windows and views relate to object identity

---

## 2. Core Thesis

Loom AI navigation is browser-like and session-based.

The graph model records object identity, origin linkage, and relationships.
The navigation model records what the user visited in the current session.

These are separate systems:

- graph origin metadata explains where a Weft came from
- session history explains where Back and Forward go

---

## Weft (Authoritative Definition)

Weft is NOT a thread.

Weft is:
- an anchored exploration path
- a new Loom created from a specific Response
- preserving a context snapshot
- allowing return to its origin

Weft supports:
- split view (origin Loom + Weft Loom)
- full view
- session-based navigation
- return-to-origin behavior

Each Weft has:
- originLoomId
- originResponseId

A Weft is always a Loom.
The difference is:
- Loom = independent container
- Weft = Loom with origin linkage

---

## Navigation Model

Navigation is session-based.

Back and Forward:
- follow session history
- do NOT recursively traverse origin chains

Weft-specific transitions:

Full Weft
→ Split Mode

Split Mode
→ Origin Loom (scroll to origin response)

Origin at C
→ Origin Loom (scroll to last response)

Then:
→ normal history continues

Important:

Weft origin chain is NOT navigation.
It is metadata.

---

## Loom Navigation Destination

Navigation operates on resolved destinations:

interface LoomNavigationDestination {
  loomId: string
  mode: "full" | "split"
  originLoomId?: string
  originResponseId?: string
  scrollTargetResponseId?: string
  scrollMode?: "origin" | "lastResponse" | "exact"
  source:
    | "userNavigation"
    | "addressBar"
    | "weftCreate"
    | "returnToOrigin"
    | "backForward"
}

---

## Weft Layout Model

Weft split view is conditional.

IF viewport supports two Loom panels:
→ Split Mode

ELSE:
→ Full Mode

Rules:
- minimum Loom width ≈ 520–600px
- no hard breakpoints
- no state loss on resize

Resize behavior:
- full → split when space allows
- split → full when space is constrained

Origin is always preserved,
but not always visible.

---

## 3. Destination History

Navigation history is a stack of resolved Loom navigation destinations.

### Creates a history entry

- opening a Loom
- creating or opening a Weft
- returning to a Weft origin
- opening a Bookmark
- selecting from Address Bar suggestions
- clicking a Graph node
- jumping from Loom History
- deep navigation to a Response item

### Does not create a history entry

- scrolling without a destination change
- hover states
- tooltip open/close
- typing in the composer
- opening or closing lightweight popovers
- resizing between split and full Weft layout

---

## 4. Weft Transitions

Creating a Weft from a Response creates a new Loom with origin metadata:

- `originLoomId`
- `originResponseId`

The new Loom may open in split mode or full mode depending on available viewport width.
The origin Loom is preserved as metadata even when not visible.

Returning to origin creates a session navigation destination with:

- `loomId = originLoomId`
- `scrollTargetResponseId = originResponseId`
- `scrollMode = "origin"`
- `source = "returnToOrigin"`

Back and Forward then continue through the session history stack.
They do not automatically walk origin metadata.

---

## 5. Window Definitions

In Loom AI, a **Window** is a bounded projection over the graph.
It is not an owner.

### 5.1 LoomWindow

Shows:
- the active Loom
- its contained Responses
- its local References

### 5.2 WeftWindow

Shows:
- a Weft Loom
- its origin linkage
- the preserved origin context when split mode is available

### 5.3 ReferenceWindow

Shows:
- Reference relationships around a node
- what it points to
- what points to it

### 5.4 TimeWindow

Shows:
- nodes bounded by time rules
- recent activity
- sliding history ranges

### 5.5 ContextWindow

Shows:
- currently linked References in the composer
- active contextual working set

### Rule

A node may appear in many windows at once.
That is correct.

---

## 6. Sidebar and Weft View

The sidebar is the primary Loom list and grouping surface.

The Weft view is a Weft projection:

- it can show origin linkage
- it can show fork relationships
- it can support dense graph/log rendering
- it is not required for basic navigation

The sidebar grouping model is organizational only.
Groups are not graph owners.

---

## 7. Graph View Relationship

Graph View is a secondary visualization mode.

It should:

- reflect the same underlying graph
- allow node-based navigation
- participate in session history
- never replace the browser-like workflow

Clicking a Graph node creates a normal navigation destination.

---

## 8. Address Resolver Integration

Navigation entries store enough data to restore a resolved Loom destination:

- canonical object identity when available
- human-readable alias path for display
- optional window/view selector
- title and type snapshot for history readability
- Weft origin metadata when the destination is a Weft Loom

Back/Forward navigates resolved destinations, not raw labels.
If an alias is stale or a target becomes deleted/unreachable, the resolver must return an explicit broken state so navigation can show recovery UI instead of silently failing.

Window-specific navigation applies after object resolution.
A `ReferenceWindow`, `TimeWindow`, `ContextWindow`, `WeftWindow`, or `LoomWindow` is a projection over graph objects, not the owner of those objects.

---

## 9. Invariants

1. Navigation is session-based.
2. Back and Forward follow session history.
3. Weft origin linkage is metadata, not navigation.
4. A Weft is always a Loom with origin linkage.
5. Split/full Weft layout is conditional and must not lose state.
6. Windows are projections, not owners.
7. Graph View and Weft View are optional projections over the same graph truth.
