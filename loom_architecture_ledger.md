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
Renaming a conversation, response, bookmark, or alias does not break canonical resolution. Address Bar URLs can remain readable while resolver correctness is anchored to object IDs.

---

## 2026-04-28T00:05:00+03:00 — Phase 1 — Bookmark as promotion boundary

**Context**  
Temporary conversational artifacts should not all become durable user-facing Loom objects automatically.

**Decision**  
Bookmarking is the primary user-acceptance and promotion step. A bookmark promotes its target into a resolvable, reusable Loom destination while preserving the target object's canonical identity.

**Consequences**  
Bookmark is not a trivial saved shortcut. It is an addressability boundary and should emit runtime ledger events such as `bookmark_created` and `address_created`.

---

## 2026-04-28T00:10:00+03:00 — Phase 1 — Windows are projections

**Context**  
Loom has Conversation, Loom/Thread, Reference, Time, and Context windows. These must not own or duplicate objects.

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
