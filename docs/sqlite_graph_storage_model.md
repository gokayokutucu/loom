# SQLite Graph Storage Model

**Document Type**: Persistence Architecture  
**Status**: Draft 1.0  
**Date**: 2026-04-28

---

## Summary

SQLite is Loom's local graph persistence layer. It stores canonical objects, typed object payloads, graph edges, addresses, aliases, revisions, windows, navigation history, and runtime ledger events.

SQLite is not the product semantics. Product semantics remain defined by:

- `docs/loom_graph_model.md`
- `docs/loom_addressing_and_resolution_model.md`
- `docs/loom_navigation_model.md`
- `docs/composer_and_reference_model.md`

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
- Typed tables: `looms`, `responses`, `quick_questions`, `bookmarks`, `fragments`, `reference_mentions`.
- `loom_edges`: typed relationships such as `contains`, `references`, `forked_from`, `promoted_from`, `anchored_to`, `mentions`.
- Addressing: `loom_addresses`, `loom_address_aliases`, `loom_revisions`.
- Windows: `loom_windows`, `loom_window_members`.
- Navigation: `loom_navigation_history`.
- Runtime ledger: `loom_ledger_events`.

The SQL draft lives in `schema/001_loom_graph.sql`.

---

## Query Patterns

### Canonical object lookup

```sql
SELECT *
FROM loom_objects
WHERE object_id = :object_id;
```

### Canonical URI resolution

```sql
SELECT o.*, a.canonical_uri
FROM loom_addresses a
JOIN loom_objects o ON o.object_id = a.target_object_id
WHERE a.canonical_uri = :canonical_uri;
```

### Active alias resolution

```sql
SELECT o.*, aa.alias_uri
FROM loom_address_aliases aa
JOIN loom_objects o ON o.object_id = aa.target_object_id
WHERE aa.alias_uri = :alias_uri
  AND aa.is_active = 1;
```

### Stale alias detection

```sql
SELECT old_alias.alias_uri AS stale_alias,
       primary_alias.alias_uri AS replacement_alias,
       o.*
FROM loom_address_aliases old_alias
JOIN loom_objects o ON o.object_id = old_alias.target_object_id
LEFT JOIN loom_address_aliases primary_alias
  ON primary_alias.target_object_id = old_alias.target_object_id
 AND primary_alias.is_active = 1
WHERE old_alias.alias_uri = :alias_uri
  AND old_alias.is_active = 0;
```

### Lineage ancestors

```sql
WITH RECURSIVE ancestors(object_id, depth) AS (
  SELECT :object_id, 0
  UNION ALL
  SELECT e.from_object_id, ancestors.depth + 1
  FROM loom_edges e
  JOIN ancestors ON e.to_object_id = ancestors.object_id
  WHERE e.edge_type IN ('contains', 'forked_from', 'derived_from')
)
SELECT * FROM ancestors ORDER BY depth;
```

### Descendants from a branch root

```sql
WITH RECURSIVE descendants(object_id, depth) AS (
  SELECT :root_object_id, 0
  UNION ALL
  SELECT e.to_object_id, descendants.depth + 1
  FROM loom_edges e
  JOIN descendants ON e.from_object_id = descendants.object_id
  WHERE e.edge_type IN ('contains', 'forked_from', 'derived_from')
)
SELECT * FROM descendants ORDER BY depth;
```

### Reference neighborhood

```sql
SELECT e.from_object_id, e.to_object_id, e.edge_type
FROM loom_edges e
WHERE e.edge_type IN ('references', 'mentions')
  AND (e.from_object_id = :object_id OR e.to_object_id = :object_id);
```

### References to an object

```sql
SELECT rm.*
FROM reference_mentions rm
WHERE rm.target_object_id = :object_id;
```

### References from a Loom

```sql
SELECT rm.*
FROM reference_mentions rm
WHERE rm.source_loom_id = :loom_id;
```

### Bookmark lookup

```sql
SELECT b.bookmark_id, b.object_id AS bookmark_object_id, b.target_object_id, b.loom_address
FROM bookmarks b
WHERE b.bookmark_id = :bookmark_id
   OR b.loom_address = :loom_address
   OR b.target_object_id = :target_object_id;
```

### Broken aliases and references

```sql
SELECT aa.alias_uri, aa.target_object_id, o.status
FROM loom_address_aliases aa
LEFT JOIN loom_objects o ON o.object_id = aa.target_object_id
WHERE o.object_id IS NULL OR o.status IN ('deleted', 'unreachable');
```

### LoomWindow projection

```sql
WITH RECURSIVE loom_objects(object_id, depth) AS (
  SELECT lw.anchor_object_id, 0
  FROM loom_windows lw
  WHERE lw.window_id = :window_id AND lw.window_type = 'loom'
  UNION ALL
  SELECT e.to_object_id, loom_objects.depth + 1
  FROM loom_edges e
  JOIN loom_objects ON e.from_object_id = loom_objects.object_id
  WHERE e.edge_type = 'contains'
)
SELECT * FROM loom_objects ORDER BY depth;
```

### Weft/Lineage window projection

```sql
WITH RECURSIVE branch(object_id, depth) AS (
  SELECT lw.anchor_object_id, 0
  FROM loom_windows lw
  WHERE lw.window_id = :window_id AND lw.window_type IN ('weft', 'lineage')
  UNION ALL
  SELECT e.to_object_id, branch.depth + 1
  FROM loom_edges e
  JOIN branch ON e.from_object_id = branch.object_id
  WHERE e.edge_type IN ('contains', 'forked_from', 'derived_from')
)
SELECT * FROM branch ORDER BY depth;
```

### ReferenceWindow projection

```sql
SELECT DISTINCT object_id
FROM (
  SELECT :anchor_object_id AS object_id
  UNION ALL
  SELECT e.from_object_id
  FROM loom_edges e
  WHERE e.edge_type IN ('references', 'mentions')
    AND e.to_object_id = :anchor_object_id
  UNION ALL
  SELECT e.to_object_id
  FROM loom_edges e
  WHERE e.edge_type IN ('references', 'mentions')
    AND e.from_object_id = :anchor_object_id
);
```

### TimeWindow projection

```sql
SELECT o.*
FROM loom_objects o
WHERE o.updated_at >= :from_time AND o.updated_at < :to_time
ORDER BY o.updated_at DESC;
```

### ContextWindow projection

```sql
SELECT wm.object_id, wm.sort_key, wm.metadata_json
FROM loom_window_members wm
JOIN loom_windows w ON w.window_id = wm.window_id
WHERE w.window_id = :window_id
  AND w.window_type = 'context'
ORDER BY wm.sort_key;
```

---

## Adapter Contract

The app should depend on a `LoomGraphRepository` interface:

- find by canonical object ID
- find by canonical URI
- find by active alias URI
- detect stale/retired aliases and replacement alias
- find bookmark by target object or URI
- validate revision/snapshot selectors
- validate window support
- read lineage ancestors
- read descendants from a branch root
- read reference neighborhoods
- read window projections for Loom, Weft/Lineage, Reference, Time, and Context windows

The current browser adapter may be in-memory. The future Electron adapter should execute the SQL schema directly.

---

## Runtime Ledger Rules

`loom_ledger_events` is append-only. Application code may insert events but must not update or delete existing ledger rows.

The ledger records audit/debug/history events. It does not replace canonical tables such as `loom_objects`, `loom_edges`, `bookmarks`, or `loom_address_aliases`.

Required event types:

- `bookmark_created`
- `address_created`
- `alias_created`
- `alias_updated`
- `alias_retired`
- `fork_created`
- `reference_mention_created`
- `fragment_created`
- `object_archived`
- `object_deleted`
- `broken_reference_detected`
- `revision_created`

Sample inspection query:

```sql
SELECT event_type, object_id, related_object_id, payload_json, created_at
FROM loom_ledger_events
WHERE object_id = :object_id OR related_object_id = :object_id
ORDER BY created_at ASC;
```
