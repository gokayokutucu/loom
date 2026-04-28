# Loom AI Companion Documents Order

## Purpose

This index defines the recommended reading and authoring order for the companion documents that sit next to `loom_ai_product_positioning_and_v_1_scope.md`.

The positioning document remains the **north-star** document.
The documents below define the deeper product semantics and interaction rules.

## Recommended Order

1. **Loom Graph Model**
   - Canonical objects
   - Edges / relationships
   - Promotion rules
   - Bookmark semantics
   - Fork rules
   - Addressability

2. **Loom Addressing and Resolution Model**
   - Stable object identity
   - Human-readable aliases
   - Bookmark promotion
   - Snapshot/revision selectors
   - Window-aware resolution
   - Broken reference states

3. **SQLite Graph Storage Model**
   - Persistence schema
   - Graph edge tables
   - Address and alias tables
   - Runtime ledger events
   - Recursive CTE query patterns

4. **Loom Tree and Navigation Model**
   - Sidebar tree
   - Commit-flow / lineage view
   - Node rendering
   - Back / Forward semantics
   - History stack
   - Window / projection rules

5. **Composer and Reference Model**
   - Per-Loom composer state
   - Inline references
   - Selection-derived references
   - `#` trigger
   - Drag-to-link
   - Undo / Redo
   - Linked references synchronization

6. **Interaction Patterns**
   - Context menus
   - Tooltips
   - Ask flow
   - Bookmark card behavior
   - Archive / delete patterns
   - Icon picker
   - Group interactions

7. **Loom Architecture Ledger**
   - Architecture decisions
   - Phase decisions
   - Resolver/schema/window consequences

## Recommended Writing Rule

- Keep `loom_ai_product_positioning_and_v_1_scope.md` high-level.
- Put structural truth in **Graph Model**.
- Put identity and URL truth in **Loom Addressing and Resolution Model**.
- Put database persistence truth in **SQLite Graph Storage Model**.
- Put navigation truth in **Loom Tree and Navigation Model**.
- Put editor/composer truth in **Composer and Reference Model**.
- Put reusable UX behavior in **Interaction Patterns**.
- Put durable architecture decisions in **Loom Architecture Ledger**.

## Important Note

Where the positioning document still contains older terms or earlier exploration artifacts, the companion documents should be treated as the more detailed product truth for those areas.
