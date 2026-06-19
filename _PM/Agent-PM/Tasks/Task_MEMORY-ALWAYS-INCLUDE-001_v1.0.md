# Task MEMORY-ALWAYS-INCLUDE-001 v1.0

## Goal

Wire confirmed, active always-include Memories into the existing Context Selection and Context Manager pipeline without introducing a general Memory Read Pipeline.

## Checklist

- [x] Confirm branch, clean baseline, and prerequisite Memory commits.
- [x] Preserve SQLite as the canonical Memory content source.
- [x] Select active, confirmed always-include explicit/profile Memories as Tier 1 candidates.
- [x] Mark always-include candidates mandatory and visible.
- [x] Exclude soft-deleted and unconfirmed Memories.
- [x] Prevent the same Memory from also entering Tier 5 retrieval.
- [x] Preserve Context Manager mandatory-overflow behavior.
- [x] Persist Context Snapshot candidate metadata without Memory content.
- [x] Validate safe always-include toggles through the existing PATCH endpoint.
- [x] Keep Retrieval ranking, Scope Resolution, Main, and Quick Ask unchanged.
- [x] Complete full validation and runtime verification.
- [x] Commit with `feat: add always-include memory semantics`.

## Scope Notes

The existing POST and PATCH Memory endpoints support the flag. No UI was added. Only `explicit_user_memory` and `profile_preference` may be confirmed always-include Memories. Full Memory Read Pipeline behavior, automatic topic generation, conflict handling, and supersession remain deferred.
