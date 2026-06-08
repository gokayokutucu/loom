# Plan: Phase 4 Provider Selection (v1.0)

## Objective
Convert the model picker from a flat model list into a provider-aware grouped model list in the frontend. This utilizes the normalized `ProviderProfile` objects and the `resolveModelSelection` helper to enable provider+model pair target routing, without changing any backend contracts, API requests, or UI settings screens.

## Scope
1. **Model Grouping**:
   - Render models grouped visually by their active provider profiles in `PromptComposer`.
   - Headers will contain the provider profile label, its kind/access badge, a sandbox badge (where applicable), and the count of models inside that group.
2. **Duplicate Model IDs**:
   - Display a model ID under each provider group it belongs to.
   - Resolve picker click to the specific provider+model pair by calling `setMainModel(modelId, providerProfileId)`.
3. **Selection State & Resolution**:
   - Calculate selection state using the `resolveModelSelection` helper.
   - Preserves existing storage format (`mainModelId` and `mainProviderProfileId` inside `providerSettings.profiles`).
4. **Backward Compatibility**:
   - Fall back gracefully to flat list if `discoveredProfiles` is empty (e.g. before loading or in typescript-local mode).
   - Auto-resolve provider mapping when only model ID exists.

## Technical Tasks
- Append group heading and badge styling in `src/styles.css`.
- Update rendering block in `src/App.tsx` within `PromptComposer`.
- Update `useLayoutEffect` height calculation logic to account for header heights.
- Write unit tests in `src/services/modelGrouping.test.ts`.
