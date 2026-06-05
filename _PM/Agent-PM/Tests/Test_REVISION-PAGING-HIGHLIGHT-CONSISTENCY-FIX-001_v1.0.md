# Test Specification: REVISION-PAGING-HIGHLIGHT-CONSISTENCY-FIX-001

## Checklist
- [x] Unit test `resolveRevisionTarget` returns origin pane and displayResponseId for revisionIndex = 0.
- [x] Unit test `resolveRevisionTarget` returns target revision details for revisionIndex = 1.
- [x] Unit test `resolveRevisionTarget` returns target revision details for revisionIndex = 2.
- [x] E2E test: Creating a 3-revision prompt edit scenario (1/3, 2/3, 3/3).
- [x] E2E test: Paging backwards from 3/3 to 2/3 highlights revision response correctly.
- [x] E2E test: Paging backwards from 2/3 to 1/3 highlights origin response correctly.
- [x] E2E test: Paging forwards from 1/3 to 2/3 highlights revision response correctly.
- [x] E2E test: Paging forwards from 2/3 to 3/3 highlights revision response correctly.
- [x] E2E test: Confirming no user-message/prompt highlights are ever applied.
