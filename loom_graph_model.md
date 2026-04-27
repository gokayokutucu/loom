# Loom Graph Model

**Document Type**: Canonical Object and Relationship Model  
**Status**: Draft 1.0

---

## 1. Purpose

This document defines the **canonical graph model** of Loom AI.

It answers these questions:

- What is a real object in Loom AI?
- What is only a view or projection?
- How do objects connect to one another?
- When does something become addressable?
- What does bookmarking or forking actually mean?

This document is not a visual layout guide.
It is the semantic truth layer.

---

## 2. Core Principle

Loom AI is not only a transcript UI.
It is a graph of addressable knowledge objects.

The graph has:

- **canonical objects**
- **edges / relationships**
- **promotion rules**
- **addressability rules**

A UI can render many views over the same graph, but the graph model stays stable.

---

## 3. Canonical Objects

## 3.1 Conversation

A **Conversation** is the top-level narrative container.

A Conversation may be:

- created from scratch
- created from a fork / thread action
- created from a derived composition flow

Suggested fields:

- `conversationId`
- `title`
- `originType: root | fork | derived`
- `forkedFromConversationId?`
- `forkedFromResponseId?`
- `createdAt`
- `updatedAt`
- `isArchived`
- `isDeleted`

### Rule
A Conversation is an owner container.
It is not just a visual tab.

---

## 3.2 Response

A **Response** is the atomic knowledge node.

A Response:
- belongs to a Conversation
- may reply to a prior Response or user turn
- may be bookmarked
- may be referenced elsewhere
- may become the anchor of a forked Conversation

Suggested fields:

- `responseId`
- `conversationId`
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

- a Conversation
- a Response
- a selected passage
- a thread/fork lineage
- a response set

Suggested fields:

- `bookmarkId`
- `targetType`
- `targetId`
- `loomAddress`
- `title`
- `createdAt`

### Rule
Bookmarking is the user-acceptance step that promotes temporary conversational content into durable Loom objects.

---

## 3.5 ReferenceMention

A **ReferenceMention** represents the reuse of one Loom object inside another context.

Examples:
- a Response referenced inside a composer
- a Conversation referenced from another Conversation
- a bookmarked object reused inside a prompt

Suggested fields:

- `mentionId`
- `sourceConversationId`
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

## 4. Non-Canonical Objects

## 4.1 Thread

User-facing term: **Thread**

Internal meaning:
A Thread is better modeled as a **lineage/fork projection** rather than a standalone owner object.

That means:
- the UI can call it Thread
- but the deeper model should treat it as a **projection or fork lineage scope**

### Rule
Thread is primarily a graph-derived path, not necessarily a new owner container unless it becomes a new Conversation.

---

## 4.2 Window

A **Window** is not an owner object.
A Window is a **bounded projection over the Loom graph**.

Examples:
- ConversationWindow
- ThreadWindow
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
- Conversation `contains` Response
- ReferenceMention `references` Response
- Conversation `forked_from` Response
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

If the user chooses Thread/Fork on a Response:
- the selected Response and its ancestry define the lineage seed
- a new Conversation may be created from that point
- the new Conversation should store:
  - `originType = fork`
  - `forkedFromResponseId`
  - `forkedFromConversationId`

## 7.2 Thread vs Conversation

User-facing:
- Thread button may say “Thread”

System-facing:
- operation is closer to `Fork Conversation from Response`

---

## 8. Reuse Rules

## 8.1 Reusing a Response

If Response A is linked inside another conversation:
- do not clone Response A as a new canonical node
- create a `ReferenceMention` that points to Response A

This preserves provenance and avoids graph duplication.

## 8.2 Reusing a Conversation

If one Conversation references another:
- do not nest the target Conversation inside the source
- create a ReferenceMention from source to target Conversation

---

## 9. QuickQuestion Promotion Rules

A QuickQuestion can stay temporary.
It becomes durable only if the user explicitly promotes it.

Possible promotions:
- convert to thread/fork
- bookmark
- preserve as a durable QuickQuestion node

---

## 10. Invariants

These must remain true:

1. A canonical object keeps a stable internal identity.
2. Bookmarking is the promotion step for addressability.
3. Reference reuse creates mentions, not clones.
4. A Thread is a lineage/fork concept, not only a visual comment chain.
5. A Window is a projection, not an owner.

---

## 11. Example

### Scenario

- User is in Conversation A
- Response R12 is useful
- User bookmarks R12
- Bookmark B7 is created
- Loom address becomes available
- Later, in Conversation B, user links R12 into a new prompt

### Result

Canonical objects:
- Conversation A
- Response R12
- Bookmark B7
- Conversation B

Edges:
- A `contains` R12
- B7 `bookmarked_as` R12
- Mention M3 in Conversation B `references` R12

No duplicate Response is created.

---

## 12. Summary

The graph truth of Loom AI is:

- **Conversation** is the owner container
- **Response** is the atomic reusable content node
- **Bookmark** is the promotion and addressability layer
- **ReferenceMention** is the reuse layer
- **QuickQuestion** may begin ephemeral and later promote
- **Thread** is best treated as a lineage/fork path rather than a simple visual comment chain
- **Window** is a projection over the graph, not an owning structure
