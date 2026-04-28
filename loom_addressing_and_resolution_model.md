# Loom Addressing and Resolution Model

**Document Type**: Addressing, Resolution, and Identity Model  
**Status**: Draft 1.0

---

## 1. Purpose

This document defines how Loom identifies, names, resolves, and serializes addressable knowledge objects.

It answers these questions:

- What is the difference between a stable identity and a human-readable path?
- Which Loom objects are addressable?
- When does an object become a user-visible Loom addressable object?
- How should broken, archived, renamed, or deleted targets resolve?
- How should Markdown links, deep links, and Address Bar strings be structured?
- How should object identity remain stable while titles and views evolve?

This document is the addressing truth layer.
It complements, but does not replace:

- `loom_graph_model.md`
- `conversation_tree_and_navigation_model.md`
- `composer_and_reference_model.md`
- `interaction_patterns.md`

---

## 2. Core Principle

Loom should **not** be modeled primarily as a location-addressed system.

A traditional URL says:

> "this thing lives at this path"

Loom needs something stronger.

A Loom address should say:

> "this stable knowledge object is being referenced here, and may be presented through a human-readable path or a specific view"

This leads to three layers:

1. **Stable Object Identity**  
   Immutable internal identity for canonical objects.

2. **Human-Readable Alias**  
   Address Bar friendly path or slug shown to the user.

3. **Optional Snapshot / Revision Identity**  
   Exact version or exact content fingerprint when needed.

The key rule is:

> Loom is **entity-addressed first**, with optional human-readable aliases and optional snapshot/content-hash layers.

---

## 3. Design Goals

The Loom addressing system should satisfy all of the following:

- **Stability**: object identity should not break when titles or labels change.
- **Readability**: users should see meaningful paths in the Address Bar when possible.
- **Durability**: broken references should fail explicitly, not silently disappear.
- **Portability**: references should serialize well into Markdown and structured exports.
- **Local-first semantics**: Loom is primarily a personal/local graph, not a public web server.
- **Projection safety**: addresses should identify objects first, not accidentally encode transient UI state.
- **Promotion control**: not every temporary thing should automatically become a stable user-facing Loom object.

---

## 4. Addressing Layers

## 4.1 Layer A: Stable Object Identity

Every canonical Loom object must have a stable internal identity.

Examples:

- Conversation
- Response
- Bookmark
- Fragment
- QuickQuestion (when canonical)

Suggested shapes:

```text
loom://o/conversation/CNV_01J...
loom://o/response/RSP_01J...
loom://o/bookmark/BMK_01J...
loom://o/fragment/FRG_01J...
```

Where:

- `o` means **object**
- the object type is explicit
- the final identifier is immutable and system-generated

### Rule

Stable object identity must never depend on:

- title
- visible slug
- current conversation order
- response index in the UI
- current window/view
- current branch depth

### Rule

Stable object identity is the final source of truth for resolution.

---

## 4.2 Layer B: Human-Readable Alias

Users should usually see a more readable form in the Address Bar.

Examples:

```text
loom://research-synthesis/address-bar-local-ai-web
loom://research-synthesis/address-bar-local-ai-web?id=RSP_01J...
loom://citations/provenance-graph-map?id=CNV_01J...
```

Or a more structured form:

```text
loom://c/research-synthesis/r/address-bar-local-ai-web?id=RSP_01J...
loom://c/research-synthesis/b/citation-reuse-and-provenance?id=BMK_01J...
```

### Rule

Human-readable aliases are **display-friendly and editable**, but not the final resolver truth.

### Rule

If a title changes, the alias may change, but the underlying object identity must remain stable.

### Rule

Alias resolution should always end at a stable object identity.

---

## 4.3 Layer C: Snapshot / Revision / Content Fingerprint

In some cases, the user or the system may need to refer to an exact revision or exact content snapshot.

Examples:

```text
loom://o/response/RSP_01J...?rev=4
loom://o/response/RSP_01J...?snapshot=sha256:abcd...
loom://o/fragment/FRG_01J...?snapshot=sha256:efgh...
```

This layer is useful when:

- exact historical content matters
- a fragment is derived from a specific textual selection
- export/import needs a precise fingerprint
- future verification or deduplication rules need content anchoring

### Rule

Content hash should be treated as a **snapshot/revision aid**, not as the primary canonical identity of Loom objects.

---

## 5. Canonical Addressable Targets

## 5.1 Conversation

A Conversation can be addressed by stable object identity.

Example:

```text
loom://o/conversation/CNV_01J...
```

Human-readable alias example:

```text
loom://research-synthesis
```

### Notes

- Conversation titles may change.
- Conversation branches may change.
- The stable conversation ID must not change.

---

## 5.2 Response

A Response is a canonical reusable node and must have a stable object identity.

Example:

```text
loom://o/response/RSP_01J...
```

Human-readable alias example:

```text
loom://research-synthesis/address-bar-local-ai-web?id=RSP_01J...
```

### Important Rule

Do not use visible response indexes like `r7` as canonical truth.
They may appear as UI helpers, but the final anchor must be an immutable response ID.

---

## 5.3 Bookmark

A Bookmark is the promotion layer that makes an object durable and user-addressable in a first-class way.

Example:

```text
loom://o/bookmark/BMK_01J...
```

Human-readable alias example:

```text
loom://bookmarks/deniz-ciftlikleri-arastirmalari?id=BMK_01J...
```

### Rule

Bookmarking is the user-acceptance / promotion step for stable Loom addressability in user-facing surfaces.

### Rule

A bookmarked object may receive:

- a stable bookmark identity
- a Loom address
- a user-editable title
- search/autocomplete visibility
- reuse eligibility in References and Address Bar results

---

## 5.4 Fragment

A Fragment is a bookmarked or promoted passage derived from a Response selection.

Example:

```text
loom://o/fragment/FRG_01J...
```

Possible alias example:

```text
loom://fragments/cevap-soyle-olabilir?id=FRG_01J...
```

Suggested fragment metadata:

- `sourceResponseId`
- `sourceConversationId`
- `rangeStart`
- `rangeEnd`
- `snapshotHash?`

### Rule

A Fragment is not the same object as the source Response.
It is a derived canonical object pointing back to its source.

---

## 5.5 Thread / Lineage Path

User-facing term: **Thread**

But in Loom’s deeper model, a Thread is usually better treated as a **lineage/fork projection** rather than a simple owner object.

This creates an important rule:

### Rule

A Thread/lineage path is not automatically a canonical stable object by default.

### Rule

A Thread becomes durable/user-addressable only when explicitly promoted/bookmarked or otherwise materialized into a stable object.

That means:

- internal projection view may exist without a first-class public address
- promoted thread lineage may get a Bookmark-backed or object-backed address

Example promoted lineage address:

```text
loom://o/bookmark/BMK_01J_THREAD...
```

or

```text
loom://threads/citation-reuse-and-provenance?id=BMK_01J_THREAD...
```

---

## 6. Non-Canonical Reuse: Reference Mentions

A Response reused inside another prompt or conversation should not create a duplicate canonical Response.

Instead, it creates a **ReferenceMention** in the new context.

### Example

Canonical object:

```text
loom://o/response/RSP_01J...
```

Prompt usage instance:

- a ReferenceMention appears in the composer
- it points to `RSP_01J...`

### Rule

Addresses should identify the target canonical object, not the mention instance, unless the mention itself becomes promoted/addressable.

---

## 7. Promotion Boundary

## 7.1 Why Promotion Exists

Not every conversational artifact should instantly become a durable Loom addressable object.

Examples of temporary things:

- suggested AI references
- ephemeral Quick Questions
- transient composer state
- temporary selected text
- ad hoc prompt references that were never accepted by the user

### Rule

User-facing addressability should cross a **promotion boundary**.

In V1, the primary promotion mechanism is:

- **Bookmark**

---

## 7.2 Promotion Rules

If an object is bookmarked:

- it becomes durable
- it receives a stable user-facing Loom address
- it can appear in bookmarks, Address Bar suggestions, and linked references
- it becomes a reusable, explicit Loom object from the user’s perspective

If an object is not promoted:

- it may still have internal stable identity
- but it should not necessarily be surfaced as a stable user-facing Loom address in all contexts

---

## 8. Resolution Model

## 8.1 Resolution Pipeline

Every Loom address should resolve through this pipeline:

1. **Parse** the address
2. **Determine layer type**
   - object identity
   - human-readable alias
   - snapshot/revision
3. **Resolve to canonical object identity**
4. **Check lifecycle state**
   - active
   - archived
   - deleted
   - unresolved
5. **Apply optional view/window parameters**
6. **Return destination + status**

---

## 8.2 Resolution States

Suggested resolver outcomes:

- `resolved`
- `resolved_archived`
- `broken_deleted`
- `broken_unknown`
- `broken_snapshot_missing`
- `broken_permission_denied` (future-safe)

### Rule

Broken references must never fail silently.

If a target is unavailable, the UI must explicitly show:

- that the target existed
- why it cannot be resolved now
- whether it is archived, deleted, or unknown

---

## 8.3 Archive vs Delete

### Archive

Archive should usually preserve resolvability.

An archived object may:
- disappear from active default lists
- still resolve correctly when addressed directly

### Delete

Delete is destructive.

If an object is deleted:
- its canonical object ID may remain as a tombstone record internally
- user-facing resolution should show a broken/deleted state
- references should not silently disappear

---

## 9. Object vs View

A Loom address should identify an **object first**, not a window/view.

Views are secondary.

### Rule

Object identity and view selection must be separate concepts.

Examples:

```text
loom://o/response/RSP_01J...?view=lineage
loom://o/response/RSP_01J...?panel=threads
loom://o/response/RSP_01J...?window=reference
```

In these examples:

- `RSP_01J...` is the object truth
- `view`, `panel`, and `window` are rendering hints or projection hints

### Rule

Changing the current UI layout or panel system must not invalidate the base object address.

---

## 10. Human-Readable Alias Rules

## 10.1 Alias Generation

A human-readable alias may be generated from:

- conversation title
- bookmark title
- response semantic title
- fragment label

### Rule

Alias generation must be deterministic enough to feel stable, but never treated as the final identity anchor.

---

## 10.2 Alias Editing

Users may rename bookmarked or promoted objects.

When that happens:
- alias/path may change
- stable internal identity must not change

### Rule

Previous aliases may optionally remain as redirect aliases, but the resolver must ultimately land on the same stable object ID.

---

## 10.3 Alias Collisions

Two different objects may want similar human-readable slugs.

### Rule

The system must resolve collisions without breaking stable identity.

Possible approaches:
- suffix numbering
- short ID suffixes
- namespace prefixes

The resolver truth must still be the object ID.

---

## 11. Markdown Serialization

Markdown is an approved text serialization format for Loom references.

### Recommended default form

```markdown
[Deniz çiftlikleri araştırmaları](loom://research-synthesis/address-bar-local-ai-web?id=RSP_01J...)
```

This form combines:
- human-readable visible text
- a readable Loom path
- the stable object ID carried in the query

### Rule

Markdown serialization should be:

- portable
- readable
- copy/paste-friendly
- resolvable back to stable identity

### Rule

UI editing does not need to expose raw Markdown by default.
Markdown is the canonical text representation, not necessarily the primary editing surface.

---

## 12. Address Bar Behavior

The Address Bar should prefer showing:

- human-readable alias/path

But internally it should resolve through:

- stable object identity

### Rule

The Address Bar display string is for humans.
The internal resolver anchor is for correctness.

### Rule

When ambiguity exists, the Address Bar should still produce a deterministic resolution to a stable object ID.

---

## 13. Content Hash Strategy

Content hash is useful, but should not be Loom’s only identity layer.

### Recommended role of content hash

Use content hashes for:

- snapshots
- revisions
- dedup heuristics
- imported artifact verification
- fragment fidelity checks

Do **not** use content hash as the only canonical identity for Conversations or Responses.

### Why not?

Because Loom objects carry more than raw content:

- lineage
- reuse relationships
- promotion state
- bookmark titles
- fragment derivation
- semantic identity over time

That means the better rule is:

> stable object ID first, content hash second

---

## 14. Example Address Forms

## 14.1 Canonical Conversation

```text
loom://o/conversation/CNV_01J8ABC...
```

## 14.2 Canonical Response

```text
loom://o/response/RSP_01J8DEF...
```

## 14.3 Human-readable Response Alias

```text
loom://research-synthesis/address-bar-local-ai-web?id=RSP_01J8DEF...
```

## 14.4 Bookmarked Response

```text
loom://o/bookmark/BMK_01J8KLM...
```

or

```text
loom://bookmarks/address-bar-local-ai-web?id=BMK_01J8KLM...
```

## 14.5 Fragment

```text
loom://o/fragment/FRG_01J8NOP...
```

## 14.6 Snapshot

```text
loom://o/response/RSP_01J8DEF...?snapshot=sha256:abcd1234...
```

## 14.7 Object with View Hint

```text
loom://o/response/RSP_01J8DEF...?view=lineage
```

---

## 15. Broken Reference Behavior

If a Markdown or Loom reference resolves to a deleted object:
- show a broken state
- keep the original reference text visible
- explain that the target is unavailable

If it resolves to an archived object:
- open it if possible in archived state
- or clearly indicate that it is archived

If alias no longer matches current title:
- still resolve through ID
- optionally update visible display text later if the UI chooses to refresh it

### Rule

Resolver correctness takes precedence over alias prettiness.

---

## 16. Invariants

These rules must remain true:

1. Every canonical Loom object has a stable internal identity.
2. Human-readable aliases are editable and secondary.
3. Bookmarking is the primary promotion boundary for user-facing addressability in V1.
4. Object identity and view/window state are separate.
5. Broken references must be explicit, not silent.
6. Content hash is a snapshot/revision tool, not the only canonical identity.
7. Reference reuse should point to canonical targets, not duplicate them.

---

## 17. Summary

The Loom addressing model should be understood like this:

- **Stable Object ID** is the truth
- **Human-readable alias** is the user-facing path
- **Snapshot/hash layer** is optional precision
- **Bookmark** is the promotion step for durable user-facing Loom addressability
- **View/window parameters** are secondary rendering hints
- **Resolution** must always land on canonical object identity and fail explicitly when impossible

In one sentence:

> Loom is **entity-addressed first**, with optional human-readable aliases and optional snapshot/content-hash precision.

---

## 18. Implementation Alignment: Graph Persistence and Resolver Boundary

The V1 implementation uses this document as the canonical addressing spec.

### 18.1 Resolver Contract

Address resolution must return an explicit state:

- `resolved`
- `not_found`
- `deleted`
- `alias_stale`
- `snapshot_missing`
- `window_invalid`
- `broken_reference`

The resolver pipeline is:

1. parse the Loom address
2. resolve canonical object ID or active alias
3. validate object status
4. validate optional revision/snapshot selector
5. apply optional view/window selector
6. return a destination or explicit failure state

### 18.2 SQLite Persistence Boundary

SQLite stores graph identity and relationships through canonical objects, typed payload tables, graph edges, canonical addresses, aliases, revisions, windows, navigation history, and append-only runtime ledger events.

The React app must not call SQLite directly. It should call a repository/resolver seam so the browser prototype can use in-memory data while Electron later provides SQLite-backed persistence.

### 18.3 Window-aware Resolution

Window selectors such as `?view=lineage` or `?window=reference` never replace object identity.

Resolution always targets an object first. The requested window is applied second. If the object exists but the requested projection is invalid, the result is `window_invalid`, not `not_found`.
