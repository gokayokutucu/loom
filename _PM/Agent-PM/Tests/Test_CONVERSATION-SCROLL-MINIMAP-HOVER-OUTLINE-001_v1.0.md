# Test_CONVERSATION-SCROLL-MINIMAP-HOVER-OUTLINE-001 v1.0

## Scope

Validate the conversation minimap hover outline panel and jump behavior.

## Test Checklist

- [x] Unit: label derivation uses title/prompt/response/fallback priority.
- [x] Unit: long labels are bounded for compact outline rows.
- [x] Unit: nearest active item is selected by scroll position.
- [x] Product E2E: minimap remains compact by default.
- [x] Product E2E: hover reveals outline panel.
- [x] Product E2E: outline rows list prompt/response labels.
- [x] Product E2E: active/nearest row is highlighted.
- [x] Product E2E: clicking outline row scrolls to matching response.
- [x] Product E2E: mouse leave collapses outline.
- [x] Product E2E: existing response tick jump still works.
- [ ] Product E2E: split/weft outline controls only that pane.
