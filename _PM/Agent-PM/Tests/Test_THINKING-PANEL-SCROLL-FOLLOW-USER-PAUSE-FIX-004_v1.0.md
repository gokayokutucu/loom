# THINKING-PANEL-SCROLL-FOLLOW-USER-PAUSE-FIX-004 Test Plan

## Unit Tests

- [x] Auto-follow is disabled during the two-second user pause window.
- [x] Auto-follow resumes when the pause expires, even away from bottom.
- [x] No pause means incoming chunks auto-follow.
- [x] Repeated user scroll-up extends the pause window.
- [x] Near-bottom detection remains available for clearing pause state.

## Product E2E

- [x] Product-service-backed ThinkingPanel stream renders Markdown.
- [x] Upward wheel gesture pauses live follow.
- [x] Incoming chunk during the pause does not pull the stream down.
- [x] After two seconds, the next incoming chunk follows to bottom.
- [x] A second upward wheel gesture restarts the pause.
- [x] Raw thinking markers stay out of persisted UI and service payloads.

## Pending Validation

- [x] `npm run build`
- [x] `npx vitest run src/services/thinkingScrollLock.test.ts`
- [x] `npx vitest run`
- [x] `E2E_PORT=5191 npx playwright test e2e/thinking-panel.spec.ts`
- [x] `git diff --check`
