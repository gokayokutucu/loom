# SQLite Graph Storage Model

**Document Type**: Persistence Architecture  
**Status**: Draft 1.0  
**Date**: 2026-04-28

---

## Summary

SQLite is Loom's local graph persistence layer. It stores canonical objects, typed object payloads, graph edges, addresses, aliases, revisions, windows, navigation history, and runtime ledger events.

SQLite is not the product semantics. Product semantics remain defined by:

- `loom_graph_model.md`
- `loom_addressing_and_resolution_model.md`
- `conversation_tree_and_navigation_model.md`
- `composer_and_reference_model.md`

The web prototype uses a repository adapter seam. Electron can later provide a SQLite-backed implementation of the same repository interface.

---

## Storage Principles

1. `loom_objects.object_id` is canonical truth.
2. Human-readable aliases are resolver inputs, not identity.
3. Bookmarks promote targets into durable addressable Loom destinations.
4. ReferenceMention rows are use-instances that point to target objects.
5. Windows store projection state only; they do not own objects.
6. Runtime ledger events are append-only and never replace graph truth.
7. Recursive CTEs are the default lineage and neighborhood traversal mechanism.

---

## Table Families

- `loom_objects`: canonical identity, type, status, timestamps.
- Typed tables: `conversations`, `responses`, `quick_questions`, `bookmarks`, `fragments`, `reference_mentions`.
- `loom_edges`: typed relationships such as `contains`, `references`, `forked_from`, `promoted_from`, `anchored_to`, `mentions`.
- Addressing: `loom_addresses`, `loom_address_aliases`, `loom_revisions`.
- Windows: `loom_windows`, `loom_window_members`.
- Navigation: `loom_navigation_history`.
- Runtime ledger: `loom_ledger_events`.

The SQL draft lives in `schema/001_loom_graph.sql`.

---

## Query Patterns

### Conversation lineage

```sql
WITH RECURSIVE lineage(object_id, depth) AS (
  SELECT :object_id, 0
  UNION ALL
  SELECT e.to_object_id, lineage.depth + 1
  FROM loom_edges e
  JOIN lineage ON e.from_object_id = lineage.object_id
  WHERE e.edge_type IN ('contains', 'forked_from')
)
SELECT * FROM lineage;
```

### Fork ancestry

```sql
WITH RECURSIVE ancestors(object_id, depth) AS (
  SELECT :object_id, 0
  UNION ALL
  SELECT e.to_object_id, ancestors.depth + 1
  FROM loom_edges e
  JOIN ancestors ON e.from_object_id = ancestors.object_id
  WHERE e.edge_type = 'forked_from'
)
SELECT * FROM ancestors ORDER BY depth;
```

### Reference neighborhood

```sql
SELECT e.from_object_id, e.to_object_id, e.edge_type
FROM loom_edges e
WHERE e.edge_type IN ('references', 'mentions')
  AND (e.from_object_id = :object_id OR e.to_object_id = :object_id);
```

### Bookmark lookup

```sql
SELECT b.bookmark_id, b.target_object_id, a.canonical_uri
FROM bookmarks b
JOIN loom_addresses a ON a.target_object_id = b.object_id
WHERE b.bookmark_id = :bookmark_id OR b.loom_address = :loom_address;
```

### Address resolution

```sql
SELECT o.*
FROM loom_addresses a
JOIN loom_objects o ON o.object_id = a.target_object_id
WHERE a.canonical_uri = :uri
UNION
SELECT o.*
FROM loom_address_aliases aa
JOIN loom_objects o ON o.object_id = aa.target_object_id
WHERE aa.alias_uri = :uri AND aa.is_active = 1;
```

### Broken aliases and references

```sql
SELECT aa.alias_uri, aa.target_object_id, o.status
FROM loom_address_aliases aa
LEFT JOIN loom_objects o ON o.object_id = aa.target_object_id
WHERE o.object_id IS NULL OR o.status IN ('deleted', 'unreachable');
```

### Thread/Loom window projection

```sql
WITH RECURSIVE branch(object_id, depth) AS (
  SELECT anchor_object_id, 0 FROM loom_windows WHERE window_id = :window_id
  UNION ALL
  SELECT e.to_object_id, branch.depth + 1
  FROM loom_edges e
  JOIN branch ON e.from_object_id = branch.object_id
  WHERE e.edge_type IN ('contains', 'forked_from')
)
SELECT * FROM branch ORDER BY depth;
```

### Time window projection

```sql
SELECT o.*
FROM loom_objects o
WHERE o.updated_at >= :from_time AND o.updated_at < :to_time
ORDER BY o.updated_at DESC;
```

---

## Adapter Contract

The app should depend on a `LoomGraphRepository` interface:

- find by canonical object ID
- find by canonical URI
- find by active alias URI
- validate revision/snapshot selectors
- validate window support

The current browser adapter may be in-memory. The future Electron adapter should execute the SQL schema directly.
