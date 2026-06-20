# Task MEMORY-READ-POLICY-001 v1.0

## Goal

Implement deterministic read-time eligibility and scope masking for Memory candidates in Context Selection.

## Checklist

- [x] Confirm branch and prerequisite conflict-supersession commit.
- [x] Preserve Context Selection as metadata verification boundary.
- [x] Load relevant global and active-Loom Memory metadata from SQLite once per selection.
- [x] Exclude deleted, superseded, forgotten, and unconfirmed Memories.
- [x] Mask global Memories when an active Loom-scoped Memory has the same non-null topic key.
- [x] Preserve global fallback when no matching scoped Memory exists.
- [x] Preserve independent eligibility for null and different topic keys.
- [x] Keep always-include Memories in Tier 1 without Tier 5 duplication.
- [x] Verify SQLite scope rather than trusting retrieval metadata.
- [x] Preserve explicit/profile priority over inferred Memory within retrieval tiers.
- [x] Persist selected Memory identities only in Context Snapshots.
- [x] Add count-only Memory read diagnostics.
- [x] Keep write policy, Main, Quick Ask, Retrieval ranking, and Scope Resolution unchanged.
- [x] Complete full validation and live runtime verification.
- [x] Commit with `feat: add memory read policy`.

## Boundary

Context Selection resolves eligibility and masking from SQLite metadata. Context Manager remains the only layer that hydrates selected Memory content. Masking never deletes or modifies the global Memory row.
