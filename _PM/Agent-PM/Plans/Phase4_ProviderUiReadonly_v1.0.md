# Plan: Provider UI Readonly Status (v1.0)

Task ID: `PROVIDER-UI-READONLY-001`  
Branch: `feature/litellm-sandbox-001`  
Objective: Add a read-only provider status section in the prompt composer's model picker menu using the `providerDiscovery` helper.

---

## 1. Objectives & Scope
- **Goals**:
  - Show a small read-only provider status display inside the model picker menu.
  - Display provider label, kind, availability, model count, sandbox badges, and warnings.
  - No settings screen modifications.
  - No provider selection UI (dropdown/checkbox/radio to change provider).
  - No changes to default model or prompt execution behavior.
- **Out of Scope**:
  - Provider selection or editing fields.
  - API key or secret exposure.

---

## 2. Technical Design & Proposed Changes

### 2.1 PromptComposer Component (`src/App.tsx`)
- Import `normalizeRuntimeProvider` and type `ProviderProfile` from `./services/providerDiscovery`.
- Introduce react state variables `discoveredProfiles` and `loadingProfiles` inside `PromptComposer`.
- Add a `useEffect` hook running on `modelPickerOpen = true` that fetches and normalizes provider statuses using:
  - `engineClient.getRuntimeProviders()`
  - `engineClient.getRuntimeModels()`
- Render a new section "Provider Status" at the bottom of the model picker menu.

### 2.2 Styling (`src/styles.css`)
- Add modern presentational CSS styling rules for the provider status items in the popover.

---

## 3. Verification Plan

### Automated Tests
- Run unit tests: `npm run test:unit`
- Run build verification: `npm run build`
- Run lint/check: `git diff --check`
