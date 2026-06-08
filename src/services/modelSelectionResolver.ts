import type { ProviderProfile } from "./providerDiscovery";

export interface ModelSelectionInput {
  selectedModelId: string;
  selectedProviderProfileId?: string;
  availableProfiles: ProviderProfile[];
}

export interface ResolvedModelSelection {
  providerProfileId?: string;
  modelId: string;
  requestModel: string;
  isAmbiguous: boolean;
  warning?: string;
}

/**
 * Resolves the generation target, separating provider profile identity from model identity.
 * Normalizes input selection so that duplicate model IDs across multiple providers can be resolved safely.
 *
 * Resolution logic rules:
 * - If `selectedProviderProfileId` is provided:
 *   - Verifies that the profile exists in `availableProfiles`.
 *   - If not found, falls back safely to undefined providerProfileId and issues a warning.
 *   - If found, verifies if `selectedModelId` exists under that profile's declared `modelIds`. Issues a warning if missing.
 * - If `selectedProviderProfileId` is NOT provided:
 *   - Searches all `availableProfiles` for ones that declare `selectedModelId`.
 *   - If 0 profiles match: returns undefined profile (safe legacy fallback).
 *   - If exactly 1 profile matches: resolves to that profile automatically.
 *   - If 2 or more profiles match: flags ambiguity (`isAmbiguous: true`) but does not block.
 * - `requestModel` remains equal to the string model ID.
 * - Secrets are not exposed. Unknown profiles do not crash resolution.
 */
export function resolveModelSelection(input: ModelSelectionInput): ResolvedModelSelection {
  const { selectedModelId, selectedProviderProfileId, availableProfiles } = input;

  if (selectedProviderProfileId) {
    const profile = availableProfiles.find((p) => p.id === selectedProviderProfileId);
    if (!profile) {
      return {
        providerProfileId: undefined,
        modelId: selectedModelId,
        requestModel: selectedModelId,
        isAmbiguous: false,
        warning: `Selected provider profile "${selectedProviderProfileId}" was not found.`,
      };
    }

    const hasModel = profile.modelIds.includes(selectedModelId);
    return {
      providerProfileId: selectedProviderProfileId,
      modelId: selectedModelId,
      requestModel: selectedModelId,
      isAmbiguous: false,
      warning: hasModel
        ? undefined
        : `Model "${selectedModelId}" is not declared in provider profile "${selectedProviderProfileId}".`,
    };
  }

  // Find all profiles containing this model
  const matchingProfiles = availableProfiles.filter((p) => p.modelIds.includes(selectedModelId));

  if (matchingProfiles.length === 0) {
    return {
      providerProfileId: undefined,
      modelId: selectedModelId,
      requestModel: selectedModelId,
      isAmbiguous: false,
    };
  }

  if (matchingProfiles.length === 1) {
    return {
      providerProfileId: matchingProfiles[0].id,
      modelId: selectedModelId,
      requestModel: selectedModelId,
      isAmbiguous: false,
    };
  }

  // Multiple matching profiles
  const profileIds = matchingProfiles.map((p) => p.id).join(", ");
  return {
    providerProfileId: undefined,
    modelId: selectedModelId,
    requestModel: selectedModelId,
    isAmbiguous: true,
    warning: `Model "${selectedModelId}" is ambiguous because it exists under multiple provider profiles: ${profileIds}.`,
  };
}

export interface RestoreModelSelectionInput {
  selectedModelId: string;
  selectedProviderProfileId?: string;
  availableProfiles: ProviderProfile[];
}

/**
 * Restores model selection while preserving backward compatibility.
 * Restore algorithm:
 * - If provider profile exists in availableProfiles: restores exact pair.
 * - Else: uses resolveModelSelection to auto-resolve where the model belongs.
 */
export function restoreModelSelection(input: RestoreModelSelectionInput): ResolvedModelSelection {
  const { selectedModelId, selectedProviderProfileId, availableProfiles } = input;

  if (selectedProviderProfileId) {
    const profileExists = availableProfiles.some((p) => p.id === selectedProviderProfileId);
    if (profileExists) {
      const profile = availableProfiles.find((p) => p.id === selectedProviderProfileId)!;
      const hasModel = profile.modelIds.includes(selectedModelId);
      return {
        providerProfileId: selectedProviderProfileId,
        modelId: selectedModelId,
        requestModel: selectedModelId,
        isAmbiguous: false,
        warning: hasModel
          ? undefined
          : `Model "${selectedModelId}" is not declared in provider profile "${selectedProviderProfileId}".`,
      };
    }
  }

  // Fall back to automatic resolution
  return resolveModelSelection({
    selectedModelId,
    selectedProviderProfileId: undefined,
    availableProfiles,
  });
}
