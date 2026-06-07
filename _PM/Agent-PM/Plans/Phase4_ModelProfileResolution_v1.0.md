# Plan: Phase 4 Model Profile Resolution (v1.0)

## Objective
Introduce a model selection resolution layer in the frontend to separate provider profile identity from model identity. This prepares the application for provider-aware routing while preserving all current UI and generation behavior.

## Scope
1. Define the types for model selection input and resolved output:
   - `ModelSelectionInput`
   - `ResolvedModelSelection`
2. Create a frontend resolution helper `resolveModelSelection` in `src/services/modelSelectionResolver.ts`.
3. Adhere to resolution rules:
   - Preserves current behavior when no provider profile is selected.
   - Sets `requestModel` as the existing model identifier.
   - Verifies existence of `selectedProviderProfileId` when provided.
   - Flags ambiguity when a model exists in multiple profiles and no provider is selected, without blocking execution.
   - Safe fallback for unknown providers (no crashes).
   - Resolves `litellm-sandbox` profile without special casing.
4. Add comprehensive unit tests in `src/services/modelSelectionResolver.test.ts`.
5. Wire the resolver safely into the generation payload generation in `src/App.tsx` and comments indicating future provider-aware routing.

## Technical Prerequisites
- Existing `ProviderProfile` structure from `src/services/providerDiscovery.ts`.
- Mock and live providers active under the feature branch.
