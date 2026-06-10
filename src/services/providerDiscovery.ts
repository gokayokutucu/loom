import type { RuntimeModelProviderStatus, RuntimeModelItem } from "../engine";

export type ProviderProfileKind =
  | "ollama"
  | "openai-compatible"
  | "custom"
  | "sandbox"
  | "unknown";

export interface ProviderProfile {
  id: string;
  label: string;
  kind: ProviderProfileKind;
  endpoint?: string;
  modelIds: string[];
  isDefault?: boolean;
  isSandbox?: boolean;
  isAvailable?: boolean;
  warning?: string;
}

/**
 * Normalizes a backend `RuntimeModelProviderStatus` and optionally associated `RuntimeModelItem[]`
 * into a frontend-safe unified `ProviderProfile`.
 */
export function normalizeRuntimeProvider(
  status: RuntimeModelProviderStatus,
  models?: RuntimeModelItem[]
): ProviderProfile {
  const id = status.providerProfileId;
  const label = status.displayName ?? id;
  const endpoint = status.baseUrl;

  let kind: ProviderProfileKind = "unknown";
  let isSandbox = false;
  let isDefault = false;

  if (id === "litellm-sandbox") {
    kind = "sandbox";
    isSandbox = true;
  } else if (status.providerKind === "ollama") {
    kind = "ollama";
    if (id === "ollama-local") {
      isDefault = true;
    }
  } else if (
    status.providerKind === "openai_compatible" ||
    status.providerKind === "openai-compatible"
  ) {
    kind = "openai-compatible";
  } else if (status.providerKind === "custom_http_later") {
    kind = "custom";
  }

  // Determine availability: available if status is "ready"
  const isAvailable = status.status === "ready";

  // Warnings mapping
  const warning =
    status.warnings && status.warnings.length > 0
      ? status.warnings.join(" ")
      : undefined;

  // Extract modelIds associated with this providerProfileId
  const matchedModels = models
    ? models.filter((m) => m.providerProfileId === id)
    : [];
  const modelIds =
    matchedModels.length > 0
      ? matchedModels.map((m) => m.modelName)
      : status.defaultModel
      ? [status.defaultModel]
      : [];

  return {
    id,
    label,
    kind,
    endpoint,
    modelIds,
    isDefault,
    isSandbox,
    isAvailable,
    warning,
  };
}
