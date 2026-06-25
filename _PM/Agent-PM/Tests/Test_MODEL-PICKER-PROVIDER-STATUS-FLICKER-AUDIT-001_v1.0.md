# Test MODEL-PICKER-PROVIDER-STATUS-FLICKER-AUDIT-001 v1.0

## Expected Behavior

- Provider Status stays stable while the model picker menu is open: it does not alternate between a previously-shown "Available" status and "Loading provider statuses..." while no real state change has occurred.
- "Loading provider statuses..." is shown only when there is no cached provider status yet (first open / empty `discoveredProfiles`).
- A background refresh (triggered only by the picker actually opening, not by unrelated app re-renders) keeps the previously known status visible instead of replacing it with the loading state.
- Opening the model picker does not cause an unbounded refetch loop while it remains open.
- Provider availability refresh and model list refresh both still function (the fetch itself — `getRuntimeProviders`/`getRuntimeModels` — is unchanged; only its trigger and the loading-state gating changed).
- Accessibility and keyboard behavior are unchanged.

## Test Cases

### Automated

- [ ] **Not added** — this codebase's vitest configuration (`vite.config.ts`) runs with `environment: "node"` and has no React Testing Library / jsdom / happy-dom dependency installed, and `PromptComposer` is an unexported, non-isolated function inside a ~23,000-line `src/App.tsx` with no existing render-test harness (confirmed: no `App.test.tsx`/component test exists anywhere in the repo, and `npx vitest run` covers 32 files / 559 tests, none of which touch this component). Extracting `PromptComposer` or adding a DOM test environment to cover this specific effect would be a disproportionate refactor for a targeted flicker fix and was out of scope per the task's explicit backend/behavior-preservation constraints. This is documented here rather than silently skipped, per the task's "if existing test harness can cover this" / "if feasible" framing.

### Manual / Code-level verification (performed)

- [x] **Root cause reproduction reasoning**: traced the `loomEngineClient` `useMemo` dependency chain (`providerSettings`, `loomGraphRepository` → `conversationResponses`) to confirm `engineClient`'s prop identity changes on events unrelated to the model picker (settings writes, active response streaming), and that the provider-status effect's `[modelPickerOpen, engineClient]` dependency array would retrigger on every such change while the picker was open, each time calling `setLoadingProfiles(true)` unconditionally.
- [x] **Fix verification — stable trigger**: confirmed the effect's dependency array now reads `[modelPickerOpen]` only, with `engineClient` accessed through `engineClientRef.current` (kept current by a separate, narrowly-scoped effect), so unrelated `engineClient` identity churn can no longer retrigger the fetch while the picker stays open.
- [x] **Fix verification — stale-while-revalidate**: confirmed `setLoadingProfiles(true)` is now conditional on `discoveredProfiles.length === 0`; when cached profiles exist, `loadingProfiles` is never set back to `true` during a same-open-session refresh, so the rendered list (gated by `{!loadingProfiles && ...}`) is never replaced by the loading message.
- [x] **Build**: `npm run build` passed (TypeScript typecheck + Vite build), confirming no type errors from the new ref/effect.
- [x] **Regression suite**: `npx vitest run` passed 559/559 — no existing tests broken.
- [x] **Manual preview smoke**: started the `Vite Frontend` dev server, loaded the app (no console errors), opened the model picker via `button[aria-label="Select model"]`, confirmed the `PROVIDER STATUS` section rendered and resolved to a single stable state ("No active providers." — expected with no `loom-service` backend running) with no repeated loading/available toggling, then closed the preview server cleanly.

## Result

Fix verified at the code level (root cause confirmed and directly addressed) and via build/regression-suite/manual preview. Full reproduction of the original flicker (which requires an active response stream or background provider-settings writes while a real `loom-service` backend is running) was not separately staged, as the dependency-chain analysis and the unconditional-loading-reset removal directly close both contributing causes identified in the audit.
