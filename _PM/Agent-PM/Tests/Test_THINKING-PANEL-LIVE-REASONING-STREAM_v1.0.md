# THINKING-PANEL-LIVE-REASONING-STREAM-001 Test Plan

## Product-Service-Backed E2E

- [x] Thinking panel shows existing progress checklist.
- [x] Live reasoning stream appears during generation.
- [x] Live reasoning stream is internally scrollable.
- [x] Manual scroll-up in reasoning stream prevents forced auto-follow.
- [x] Final persisted response excludes live reasoning text.
- [x] Reloaded response does not show live reasoning text.
- [x] Execute targeted Playwright test.

## Unit / Integration

- [x] Provider parser preserves reasoning only as transient stream text.
- [x] Provider event collection excludes thinking delta from visible answer text.
- [x] Rust HTTP client maps transient thinking delta to renderer event.
- [x] Execute targeted unit tests.
