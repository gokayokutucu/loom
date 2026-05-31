# Loom Graph Model

**Document Type**: Canonical Object and Relationship Model  
**Status**: Draft 1.0

---

## 1. Purpose

This document defines the **canonical graph model** of Loom.

It answers these questions:

- What is a real object in Loom?
- What is only a view or projection?
- How do objects connect to one another?
- When does something become addressable?
- What does bookmarking or forking actually mean?

This document is not a visual layout guide.
It is the semantic truth layer.

---

## 2. Core Principle

Loom is not only a transcript UI.
It is a graph of addressable knowledge objects.

The graph has:

- **canonical objects**
- **edges / relationships**
- **promotion rules**
- **addressability rules**

A UI can render many views over the same graph, but the graph model stays stable.

---

## 3. Canonical Objects

## 3.1 Loom

A **Loom** is the top-level narrative container.

A Loom may be:

- created from scratch
- created from a Weft action
- created from a derived composition flow

Suggested fields:

- `loomId`
- `title`
- `originType: root | fork | derived`
- `originLoomId?`
- `originResponseId?`
- `forkedFromLoomId?`
- `forkedFromResponseId?`
- `createdAt`
- `updatedAt`
- `isArchived`
- `isDeleted`

### Rule
A Loom is an owner container.
It is not just a visual tab.

### Weft Rule
A Weft is a Loom with origin linkage.

It stores:

- `originLoomId`
- `originResponseId`

The Weft object is a real Loom object. Its Weft behavior comes from origin metadata and graph edges, not from being a separate owner type.

---

## 3.2 Response

A **Response** is the atomic knowledge node.

A Response:
- belongs to a Loom
- may reply to a prior Response or user turn
- may be bookmarked
- may be referenced elsewhere
- may become the anchor of a forked Loom

Suggested fields:

- `responseId`
- `loomId`
- `parentResponseId?`
- `role: user | assistant | system`
- `content`
- `title?`
- `createdAt`
- `isAddressable`

### Rule
A Response is the most important reusable content node in the system.

---

## 3.3 QuickQuestion

A **QuickQuestion** starts as a lightweight contextual interaction.

It may remain temporary, or it may be promoted into a durable node.

Suggested fields:

- `quickQuestionId`
- `anchorResponseId`
- `status: ephemeral | promoted | discarded`
- `createdAt`
- `content`

### Rule
QuickQuestion is canonical, but may begin in an ephemeral state.

---

## 3.4 Bookmark

A **Bookmark** is the promotion layer that makes something first-class and Loom-addressable.

A Bookmark may point to:

- a Loom
- a Response
- a selected passage
- a Weft
- a response set

Suggested fields:

- `bookmarkId`
- `targetType`
- `targetId`
- `loomAddress`
- `title`
- `createdAt`

### Rule
Bookmarking is the user-acceptance step that promotes temporary Loom content into durable Loom objects.

---

## 3.5 ReferenceMention

A **ReferenceMention** represents the reuse of one Loom object inside another context.

Examples:
- a Response referenced inside a composer
- a Loom referenced from another Loom
- a bookmarked object reused inside a prompt

Suggested fields:

- `mentionId`
- `sourceLoomId`
- `targetType`
- `targetId`
- `createdAt`
- `rangeStart?`
- `rangeEnd?`

### Rule
A ReferenceMention is not the target object itself.
It is the usage instance of that object in a new context.

This distinction is critical.

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

## 4. Non-Canonical Objects

## 4.1 Window

A **Window** is not an owner object.
A Window is a **bounded projection over the Loom graph**.

Examples:
- LoomWindow
- WeftWindow
- ReferenceWindow
- TimeWindow
- ContextWindow

### Rule
The same node can appear in multiple windows.
This is correct and expected.

---

## 5. Edge Types

Suggested relationship types:

- `contains`
- `references`
- `forked_from`
- `derived_from`
- `bookmarked_as`
- `promoted_from`
- `mentions`
- `anchored_to`

### Example
- Loom `contains` Response
- ReferenceMention `references` Response
- Loom `forked_from` Response
- Weft Loom `forked_from` origin Response
- Weft Loom `derived_from` origin Loom
- Bookmark `bookmarked_as` Response
- QuickQuestion `anchored_to` Response

---

## 6. Bookmarking and Addressability

## 6.1 Bookmark Promotion Rule

If an item is bookmarked:
- it becomes Loom-addressable
- it receives a canonical Loom address
- it becomes reusable by search, history, references, and linking

## 6.2 Suggested Names

The system may propose an initial title.
The user must always be able to rename it.

## 6.3 Addressability Boundary

Addressability should not depend only on a visible title.
It should depend on:
- stable internal identity
- promoted/bookmarked state
- resolvable Loom address

---

## 7. Fork Rules

## 7.1 Fork from Response

If the user chooses Weft on a Response:
- the selected Response and its ancestry define the Weft seed
- a new Loom may be created from that point
- the new Loom should store:
  - `originType = fork`
  - `originResponseId`
  - `originLoomId`
  - `forkedFromResponseId`
  - `forkedFromLoomId`
- the graph should store:
  - Weft Loom `forked_from` origin Response
  - Weft Loom `derived_from` origin Loom

## 7.2 Weft vs Loom

User-facing:
- Weft button may say “Weft”

System-facing:
- operation creates a Loom with Weft origin linkage

---

## 8. Reuse Rules

## 8.1 Reusing a Response

If Response A is linked inside another Loom:
- do not clone Response A as a new canonical node
- create a `ReferenceMention` that points to Response A

This preserves provenance and avoids graph duplication.

## 8.2 Reusing a Loom

If one Loom references another:
- do not nest the target Loom inside the source
- create a ReferenceMention from source to target Loom

---

## 9. QuickQuestion Promotion Rules

A QuickQuestion can stay temporary.
It becomes durable only if the user explicitly promotes it.

Possible promotions:
- convert to Weft
- bookmark
- preserve as a durable QuickQuestion node

---

## 10. Invariants

These must remain true:

1. A canonical object keeps a stable internal identity.
2. Bookmarking is the promotion step for addressability.
3. Reference reuse creates mentions, not clones.
4. A Weft is a Loom with origin linkage.
5. A Window is a projection, not an owner.

---

## 11. Example

### Scenario

- User is in Loom A
- Response R12 is useful
- User bookmarks R12
- Bookmark B7 is created
- Loom address becomes available
- Later, in Loom B, user links R12 into a new prompt

### Result

Canonical objects:
- Loom A
- Response R12
- Bookmark B7
- Loom B

Edges:
- A `contains` R12
- B7 `bookmarked_as` R12
- Mention M3 in Loom B `references` R12

No duplicate Response is created.

---

## 12. Summary

The graph truth of Loom is:

- **Loom** is the owner container
- **Response** is the atomic reusable content node
- **Bookmark** is the promotion and addressability layer
- **ReferenceMention** is the reuse layer
- **QuickQuestion** may begin ephemeral and later promote
- **Weft** is a Loom with origin linkage from a specific Response
- **Window** is a projection over the graph, not an owning structure

---

## 13. SQLite Persistence Alignment

The graph model maps to SQLite through `docs/sqlite_graph_storage_model.md` and `schema/001_loom_graph.sql`.

Persistence rules:

- `loom_objects.object_id` is the canonical graph identity.
- Typed tables store object-specific payloads.
- `loom_edges` stores relationships such as `contains`, `references`, `forked_from`, `promoted_from`, `anchored_to`, and `mentions`.
- Bookmark promotion creates durable address records without cloning the target object.
- ReferenceMention rows are use-instances and must not duplicate the target Response.
- Windows may cache projection membership, but they never own objects.
