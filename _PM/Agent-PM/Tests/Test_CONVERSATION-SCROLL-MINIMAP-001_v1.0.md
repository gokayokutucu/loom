# Test_CONVERSATION-SCROLL-MINIMAP-001 v1.0

## Scope

Validate the Loom transcript minimap geometry and product UI behavior.

## Test Checklist

- [x] Unit: anchor offset converts to minimap percentage.
- [x] Unit: viewport thumb top/height comes from scrollTop/clientHeight/scrollHeight.
- [x] Unit: viewport thumb is clamped.
- [x] Unit: short transcripts avoid division errors.
- [x] Unit: dense item percentages remain stable.
- [x] Product E2E: long service-created conversation shows minimap.
- [x] Product E2E: minimap viewport moves when transcript scrolls.
- [x] Product E2E: clicking response tick scrolls that pane to the response anchor.
- [ ] Product E2E: split/weft pane minimap isolation.
- [ ] Product E2E: streaming growth updates minimap while tokens arrive.
