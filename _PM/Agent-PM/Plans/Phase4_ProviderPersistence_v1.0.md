# Plan: Phase 4 Provider Persistence (v1.0)

## Objective
Persist provider-aware model selection (`selectedProviderProfileId` and `selectedModelId`) in the frontend while preserving backward compatibility with legacy single model ID configurations.

## Scope
1. **Extend Settings Model**:
   - Update `ModelProfileSettings` in `src/services/modelProviders.ts` to include `quickProviderProfileId?: string;`.
   - Update `mergeSettings` in `src/services/modelProviders.ts` to preserve `mainProviderProfileId` and `quickProviderProfileId` from the raw localStorage value without forcing a default of `ollama-local` on startup if it is not present in local storage.
2. **Implement Restore Algorithm**:
   - Add `restoreModelSelection` to `src/services/modelSelectionResolver.ts`.
   - Restore logic:
     - If provider profile exists: restore exact pair.
     - Else: use `modelSelectionResolver` to auto-resolve where the model belongs.
3. **Startup Restore Hook**:
   - Wire a `useEffect` inside `LoomApp` in `src/App.tsx` that triggers when `discoveredProfiles` is loaded.
   - It will run `restoreModelSelection` on the current main and quick model settings.
   - If the resolved provider profile ID differs from the stored state, it will update and persist the settings automatically.
4. **No Backend Schema Changes**:
   - All persistence is on the frontend via `localStorage`. Backend `updateServiceConfig` schema remains unchanged.
5. **Unit Tests**:
   - Implement tests for legacy restore, exact restore, missing provider fallback, duplicate model restore, and LiteLLM sandbox restore in `src/services/modelSelectionResolver.test.ts`.

## Technical Prerequisites
- `modelSelectionResolver.ts` created in the previous task.
- `discoveredProfiles` state lifted and populated in `LoomApp`.
