# Test Execution Plan - Revision Paging Response Highlight Only Fix

## E2E Tests
- [x] Click Previous revision (1/2):
  - [x] Original prompt (Prompt B) is preserved in main/origin Loom.
  - [x] Main Loom's assistant-message block receives `.revision-focus-highlight--response`.
  - [x] Main Loom's user-turn block does NOT receive any highlight.
  - [x] Main Loom composer (textbox "Prompt") is NOT focused.
  - [x] Highlight disappears after duration.
- [x] Click Next revision (2/2):
  - [x] Split/weft panel target assistant-message receives `.revision-focus-highlight--response`.
  - [x] Split/weft panel user-turn block does NOT receive any highlight.
  - [x] Scroll behavior uses native/previous split layout scrolling.
