# QA MODEL-PICKER-PROVIDER-STATUS-FLICKER-AUDIT-001 v1.0

## UI Behavior

- [x] Provider Status no longer resets to "Loading provider statuses..." while cached profile data already exists.
- [x] "Loading provider statuses..." appears only on first load when no provider status data exists yet.
- [x] Opening the model picker no longer retriggers the provider-status fetch on every unrelated `engineClient` identity change (e.g. active response streaming, unrelated provider-settings writes) — the fetch is now keyed solely on `modelPickerOpen`.
- [x] Provider availability refresh still functions — the underlying `getRuntimeProviders`/`getRuntimeModels` calls and `normalizeRuntimeProvider` mapping are unchanged.
- [x] Model list refresh still functions — untouched code path.
- [x] Accessibility and keyboard behavior unchanged — no DOM/ARIA/focus changes were made; only effect dependencies and a loading-state guard.

## Scope Guard

- [x] No backend provider runtime, provider bridge, model execution, AgentRuntime, or ToolScheduler code touched.
- [x] No provider adapter code touched.
- [x] No persisted provider settings schema/behavior changed.
- [x] Frontend-only change, confined to `src/App.tsx` (`PromptComposer`).
- [x] Not pushed.

## Verification

- [x] `npm run build` passed.
- [x] `npx vitest run` passed, 559/559.
- [x] `git diff --check` passed.
- [x] Manual preview smoke (Vite dev server) passed: app loads without console errors; model picker opens, Provider Status section renders and resolves once to a stable state with no flicker observed.
- [x] Rust/service code untouched — `cargo test` not run, per project convention for frontend-only changes.

No regressions identified.
