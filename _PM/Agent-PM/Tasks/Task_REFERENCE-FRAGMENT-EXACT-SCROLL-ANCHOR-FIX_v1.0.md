# REFERENCE-FRAGMENT-EXACT-SCROLL-ANCHOR-FIX-001

Task ID: REFERENCE-FRAGMENT-EXACT-SCROLL-ANCHOR-FIX-001
Status: completed

Objective:
- Restore exact selected-text fragment scrolling for Reference chips without changing Reference identity semantics.

Checklist:
- [x] Audit selected-text Reference metadata and current renderer anchors.
- [x] Extend navigation destination with fragment scroll metadata.
- [x] Resolve selected text within the mounted source Response.
- [x] Fall back only to source Response top when fragment resolution fails.
- [x] Preserve response-level Reference scrolling.
- [x] Add targeted tests.
- [x] Run validation.

Notes:
- Current `LoomLink` metadata includes selected text, source Loom/Response IDs, and fragment hash, but no character offsets.
- Current assistant markdown rendering does not emit stable selected-text fragment anchors.
