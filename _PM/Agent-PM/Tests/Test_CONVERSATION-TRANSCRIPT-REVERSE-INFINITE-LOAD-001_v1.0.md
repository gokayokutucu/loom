# Test Plan: CONVERSATION-TRANSCRIPT-REVERSE-INFINITE-LOAD-001

## Service Tests

- [x] Latest page returns only the newest 20 response pairs by default.
- [x] Older page returns the previous 20 response pairs from the oldest loaded cursor.
- [x] Around-target page includes the target response pair and reports correct cursors.
- [x] Outline metadata excludes full response body content and raw thinking fields.
- [x] `hasOlder` / `hasNewer` are accurate at top, middle, and bottom ranges.

## Client/UI Tests

- [x] Rust HTTP client maps transcript page and outline responses.
- [x] Initial Loom open renders the latest 20 response items, not all items.
- [x] Scrolling near the top loads older items and preserves visual scroll position.
- [x] Minimap can display unloaded outline items without response bodies.
- [x] Clicking an unloaded minimap item loads the containing page before scrolling.
- [x] Split/weft transcript behavior remains pane-local.

## Validation

- [x] `cargo fmt --manifest-path services/loom-service/Cargo.toml --check`
- [x] `cargo check --manifest-path services/loom-service/Cargo.toml`
- [x] `cargo test --manifest-path services/loom-service/Cargo.toml`
- [x] `npm run service:check`
- [x] `npm run service:test`
- [x] `npm run build`
- [x] `npx vitest run`
- [x] Targeted Playwright E2E for transcript paging.
- [x] `git diff --check`
