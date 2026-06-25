# Task MODEL-PICKER-PROVIDER-STATUS-FLICKER-AUDIT-001 v1.0

## Goal

Audit and fix the Model Picker Provider Status flicker (`Ollama Local Available` rapidly alternating with `Loading provider statuses...` while the menu is open).

## Checklist

- [x] Find the model picker component — `PromptComposer` in `src/App.tsx` (no separate `ModelPicker` file exists; the picker markup is inline, gated by `modelPickerOpen`).
- [x] Find provider status loading state — `loadingProfiles`/`discoveredProfiles` state (`src/App.tsx:19146-19147`), rendered at `src/App.tsx:22554-22592` under the `PROVIDER STATUS` section.
- [x] Find polling/refetch interval logic — no `setInterval`; the fetch is effect-driven (`useEffect` keyed on `[modelPickerOpen, engineClient]`, originally at `src/App.tsx:19894-19919`).
- [x] Find composer model list open/close lifecycle — `modelPickerOpen` boolean state, toggled by the model picker button; a sibling auto-scan effect and an outside-click/position effect both key off the same flag.
- [x] Find whether provider status query is invalidated repeatedly while picker is open — **yes**. The effect's dependency array included `engineClient`, a prop whose identity is recreated by a `useMemo` in the parent (`loomEngineClient`, deps `[currentLoomExportTarget, loomGraphRepository, providerSettings]`). `providerSettings` changes any time `onProviderSettingsChange` fires anywhere in the app (including the sibling auto-scan effect's own success/offline branches), and `loomGraphRepository` changes whenever `conversationResponses` changes (i.e. on every streamed token of an active generation). Either cause recreates `engineClient`'s identity, which retriggers the provider-status effect while the picker stays open.
- [x] Find whether loading state clears existing successful data — **yes**. The effect unconditionally called `setLoadingProfiles(true)` on every run, and the render gated the whole status list behind `{!loadingProfiles && ...}`, so every retrigger blanked the previously-rendered "Available" status back to "Loading provider statuses..." even though `discoveredProfiles` from the prior fetch was still valid in state.
- [x] Find whether provider status refresh should use stale-while-revalidate instead — yes; implemented (see below).

## Root Cause

The provider-status `useEffect` in `PromptComposer` (`src/App.tsx`) depended on `engineClient`, an unstable prop reference recreated by the parent's `loomEngineClient` `useMemo` whenever `providerSettings` or `loomGraphRepository` (itself dependent on live-streaming `conversationResponses`) changed identity. Every such recreation retriggered the effect while the model picker was open, and the effect unconditionally reset `loadingProfiles` to `true` before each fetch — discarding the already-successful `discoveredProfiles` from view and flashing "Loading provider statuses..." back over the previously shown "Ollama Local Available" state, then flipping back once the fetch resolved. Repeated unrelated state changes elsewhere in the app (most plausibly active response streaming) caused this to repeat rapidly, producing the reported flicker.

## Fix

- [x] Added `engineClientRef` (a ref kept in sync with the `engineClient` prop via its own effect) so the provider-status fetch reads the latest client without making it a reactive dependency.
- [x] Changed the effect's dependency array from `[modelPickerOpen, engineClient]` to `[modelPickerOpen]` (with the same `eslint-disable-next-line react-hooks/exhaustive-deps` pattern already used by the sibling auto-scan effect in this same component, for the same reason) — the fetch now only (re)runs when the picker actually opens or closes, not on every unrelated `engineClient` identity change.
- [x] Implemented stale-while-revalidate: `setLoadingProfiles(true)` is now only called when `discoveredProfiles.length === 0`. When cached profiles already exist, a background refresh leaves the existing list rendered (since `loadingProfiles` stays `false`), so "Ollama Local Available" never disappears mid-display.

## Scope Guard

- [x] No backend provider runtime, provider bridge, model execution, AgentRuntime, ToolScheduler, or provider adapter code touched — `src/App.tsx` (frontend) only.
- [x] No persisted provider settings schema/behavior changed — `onProviderSettingsChange`/`providerSettings` usage is unchanged; only the *trigger* for an unrelated effect was decoupled.
- [x] Accessibility/keyboard behavior unchanged — no DOM structure, ARIA attributes, or focus handling were touched; only the effect's dependency array and a loading-state guard.
- [x] Not pushed.

## Validation Evidence

- `npm run build` (`tsc && vite build`): passed.
- `npx vitest run`: passed, 559/559 (unchanged — no existing test exercises this code path; see Test doc for why component-level testing isn't feasible with the current harness).
- `git diff --check`: passed.
- Manual preview verification (`Vite Frontend` dev server): app loads with no console errors; opening the model picker renders the `PROVIDER STATUS` section once and resolves to a single stable state ("No active providers." — expected since no `loom-service` backend was running in this preview) with no repeated loading/available toggling observed.
- Rust/service code untouched — `cargo test` not required per project convention and was not run.
