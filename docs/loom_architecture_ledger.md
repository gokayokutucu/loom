# Loom Architecture Ledger

**Document Type**: Append-only architecture decision ledger  
**Status**: Active  
**Start Date**: 2026-04-28

This ledger records durable design decisions for Loom AI addressing, graph persistence, resolution, windows, and runtime audit behavior.

Runtime graph events belong in SQLite table `loom_ledger_events`; this markdown file records architecture decisions only.

---

## 2026-04-28T00:00:00+03:00 — Phase 1 — Entity-addressed Loom identity

**Context**
Loom needs human-readable addresses without making titles, slugs, response order, window state, or content hashes the canonical identity.

**Decision**
Loom is entity-addressed first. Stable internal object IDs are canonical. Human-readable aliases are secondary resolver inputs. Snapshot hashes and revision numbers are optional precision layers for exact historical content, not primary identity.

**Consequences**
Renaming a Loom, response, bookmark, or alias does not break canonical resolution. Address Bar URLs can remain readable while resolver correctness is anchored to object IDs.

---

## 2026-04-28T00:05:00+03:00 — Phase 1 — Bookmark as promotion boundary

**Context**
Temporary Loom artifacts should not all become durable user-facing Loom objects automatically.

**Decision**
Bookmarking is the primary user-acceptance and promotion step. A bookmark promotes its target into a resolvable, reusable Loom destination while preserving the target object's canonical identity.

**Consequences**
Bookmark is not a trivial saved shortcut. It is an addressability boundary and should emit runtime ledger events such as `bookmark_created` and `address_created`.

---

## 2026-04-28T00:10:00+03:00 — Phase 1 — Windows are projections

**Context**
Loom has LoomWindow, WeftWindow, ReferenceWindow, TimeWindow, and ContextWindow projections. These must not own or duplicate objects.

**Decision**
Windows are bounded projections over the graph. Address resolution targets an object first, then applies optional window/view parameters.

**Consequences**
The same Response can appear in many windows. Window invalidity is a resolver state, not object lookup failure.

---

## 2026-04-28T00:15:00+03:00 — Phase 2 — SQLite graph storage shape

**Context**
The web prototype remains React/Vite, but the future Electron shell needs a local graph persistence model.

**Decision**
SQLite is the persistence contract. Use typed object tables plus `loom_objects`, `loom_edges`, address/alias/revision tables, window projection tables, navigation history, and append-only runtime ledger events. The React app talks to a repository interface, not directly to SQLite.

**Consequences**
The browser prototype can use an in-memory adapter now. Electron can later provide a SQLite-backed adapter without rewriting product UI.

---

## 2026-04-28T00:20:00+03:00 — Phase 3 — Resolver result states are explicit

**Context**
Broken references must not disappear silently, and aliases/windows/snapshots can fail for different reasons.

**Decision**
The resolver returns explicit states: `resolved`, `not_found`, `deleted`, `alias_stale`, `snapshot_missing`, `window_invalid`, and `broken_reference`.

**Consequences**
UI can show the correct recovery path. History, Address Bar, Bookmarks, composer references, and Loom windows can share one resolver contract.

---

## 2026-04-28T00:35:00+03:00 — Phase 2 — Repository seam covers graph read models

**Context**
The resolver seam existed, but Phase 2 needs a repository contract that can support future SQLite-backed graph reads rather than only object lookup and path normalization.

**Decision**
The repository seam includes canonical object lookup, canonical URI resolution, active/stale alias resolution, bookmark lookup, lineage reads, descendant reads, reference neighborhoods, and window projection reads.

**Consequences**
The browser prototype can keep using an in-memory repository, while the future SQLite adapter can implement the same graph-oriented read contract without changing UI code.

---

## 2026-04-28T00:40:00+03:00 — Phase 2 — Runtime ledger is append-only audit, not graph truth

**Context**
Loom needs runtime event history for debugging, audit, and recovery, but the ledger must not become the only source of graph state.

**Decision**
`loom_ledger_events` is append-only. It records events such as bookmark/address/alias/fork/reference/fragment/archive/delete/broken-reference/revision changes. Canonical graph truth remains in `loom_objects`, typed tables, edges, addresses, aliases, and windows.

**Consequences**
Runtime history is inspectable without creating an event-sourcing dependency. SQLite triggers should reject ledger updates and deletes.

---

## 2026-04-28T00:45:00+03:00 — Phase 2 — Window projection reads are object-first

**Context**
Windows can be represented in the database, but they must not become owners or alternate object identities.

**Decision**
Window reads apply after object resolution. Loom, Weft/Lineage, Reference, Time, and Context windows are projections or caches over existing object IDs.

**Consequences**
The same object can appear in multiple windows. Invalid window requests return `window_invalid`; they do not become object lookup failures.
