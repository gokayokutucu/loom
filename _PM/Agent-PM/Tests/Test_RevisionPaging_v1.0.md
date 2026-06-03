# Test Execution Plan - Revision Paging Anchor and Highlight Fix

## Unit Tests
- [x] Test `resolveRevisionTarget` returns origin pane and displayResponseId for revisionIndex = 0.
- [x] Test `resolveRevisionTarget` returns target revision details for revisionIndex > 0.
- [x] Test `resolveRevisionTarget` handles missing childResponse in childResponses list during initial generation.
- [x] Test `resolveRevisionTarget` returns null if revisionIndex is out of bounds.

## E2E Tests
- [x] Click Previous revision (1/2):
  - [x] Original prompt (Prompt B) is preserved in main/origin Loom.
  - [x] Main Loom's user-turn and assistant-message blocks are highlighted.
  - [x] Main Loom composer (textbox "Prompt") is focused.
  - [x] Highlight disappears after duration.
- [x] Click Next revision (2/2):
  - [x] Split/weft panel target user-turn and assistant-message are highlighted.
  - [x] Main/origin Loom text is not mutated.
