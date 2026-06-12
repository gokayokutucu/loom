# Task: PM-DOC-HYGIENE-RULES-001 v1.0

## Context & Rationale
Agent-PM files committed to the repository must remain clean, portable, and free of local-only details, user paths, or credentials. This task establishes explicit repository hygiene guidelines, checks existing plans/QA checklists, and integrates a pre-commit audit checklist.

## Scope & Actions
- [x] Audit the `_PM/Agent-PM/` directory for forbidden local/private markers.
- [x] Create [PM_DOC_HYGIENE.md](../PM_DOC_HYGIENE.md) outlining clear repo-safe rules and preferred replacements.
- [x] Reference hygiene rules in [README.md](../README.md).
- [x] Sanitize absolute user paths (`/Users/gokay/Documents/Workspace/LoomAI/` -> relative repo paths) across:
  - `_PM/Agent-PM/Plans/Phase4_Concurrency_v1.1.md`
  - `_PM/Agent-PM/Plans/Phase4_MinimapExpandedMorphList_v1.1.md`
  - `_PM/Agent-PM/Plans/Phase4_MinimapExpandedMorphList_v1.0.md`
  - `_PM/Agent-PM/Plans/Phase4_MinimapExpandedCleanList_v1.0.md`
  - `_PM/Agent-PM/Plans/Phase4_SplitPaneReturnControlLeak_v1.0.md`
  - `_PM/Agent-PM/Plans/Phase1_RevisionPaging_v1.0.md`
  - `_PM/Agent-PM/Plans/Phase4_ProviderRouting_v1.0.md`
  - `_PM/Agent-PM/Plans/Phase4_ProviderAbstraction_v1.0.md`
- [x] Sanitize local process IDs and absolute binary path in:
  - `_PM/Agent-PM/Tests/Test_AGENT-RUNTIME-CANCELLATION-001_v1.0.md`
  - `_PM/Agent-PM/Tests/Test_PHASE-4-PROVIDER-RUNTIME-COMPLETION-REVIEW_v1.0.md`
- [x] Verify no `/Users/` or absolute `file:///` URLs remain under `_PM/Agent-PM/`.

## Validation Commands
- Git whitespace check: `git diff --check`
- Audit grep command:
  ```bash
  git diff | grep -Ei "file://|/Users/|/private/|Library/Application Support|PID|fingerprint|inode|Bearer|Authorization|api[_-]?key|secret|token|\\.gemini|antigravity|scratch" || true
  ```

## Known Limitations
- The audit grep check is not a blocking CI command; it remains a manual/pre-commit inspection recommendation.
- Some terms (like `fingerprint`, `token`, `secret`) are allowed when they refer to technical features rather than actual values or local hashes.
