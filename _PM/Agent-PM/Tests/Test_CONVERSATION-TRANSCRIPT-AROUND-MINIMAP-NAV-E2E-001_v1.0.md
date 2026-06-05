# Test Plan: CONVERSATION-TRANSCRIPT-AROUND-MINIMAP-NAV-E2E-001

## Automated Tests

- [x] TypeScript build validates minimap and transcript page contracts.
- [x] Service tests validate transcript paging API.
- [x] Vitest suite validates existing frontend services.
- [x] Playwright spec includes reverse loading and unloaded minimap navigation coverage.
- [x] Playwright spec executed successfully in local-port-capable environment.

## Product E2E Assertions

- [x] Temp SQLite DB/config are used by the harness.
- [x] loom-service is started by the harness from the debug binary.
- [x] Long transcript data is created through a local-only service dev endpoint.
- [x] Initial DOM mounts only latest page, not all 100 responses.
- [x] Scrolling to top loads older response page.
- [x] Prepend path checks duplicate response ids.
- [x] Clicking an unloaded outline row requests around-page navigation.
- [x] Target response mount and scroll assertions are present.
- [x] E2E execution proof captured.
