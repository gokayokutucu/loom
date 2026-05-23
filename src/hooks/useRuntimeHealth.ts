import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchWithTimeout,
  getProfileModel,
  mapOllamaError,
  mergeOllamaModels,
  normalizeOllamaModelId,
  ollamaVersionSecurityStatus,
  reconcileModelProfiles,
  runtimeHealthMessage,
  validateOllamaBaseUrlSecurity,
  type AIProviderSettings,
  type ModelProfileId,
  type RuntimeHealthState,
} from "../services/modelProviders";

function baseHealth(settings: AIProviderSettings, profile: ModelProfileId): RuntimeHealthState {
  const selectedModel = getProfileModel(settings, profile);
  const installedModels = settings.ollama.models.filter((model) => model.installed);
  const status =
    settings.ollama.lastConnectionStatus === "connected"
      ? "ready"
      : settings.ollama.lastConnectionStatus === "offline"
        ? "not_running"
        : "unknown";
  const checkedAtMs = settings.ollama.lastCheckedAt
    ? Date.parse(settings.ollama.lastCheckedAt)
    : 0;
  const stale = !checkedAtMs || Date.now() - checkedAtMs > 30_000;
  return {
    ollama_installed: settings.ollama.lastConnectionStatus === "connected",
    ollama_running: settings.ollama.lastConnectionStatus === "connected",
    models_available: installedModels.length > 0,
    selected_model_ready: Boolean(selectedModel.installed),
    status,
    message: runtimeHealthMessage(status, settings.ollama.baseUrl),
    checkedAt: settings.ollama.lastCheckedAt,
    ollama: {
      runtimeReachable: settings.ollama.lastConnectionStatus === "connected",
      tagsReachable: settings.ollama.lastConnectionStatus === "connected",
      availableModels: installedModels.map((model) => model.id),
      selectedModelAvailable: Boolean(selectedModel.installed),
      lastCheckedAt: settings.ollama.lastCheckedAt,
      lastErrorKind:
        settings.ollama.lastConnectionStatus === "offline"
          ? "runtime_unavailable"
          : undefined,
      stale,
      security: {
        localOnly: validateOllamaBaseUrlSecurity(settings.ollama.baseUrl).localOnly,
        networkExposureRisk: validateOllamaBaseUrlSecurity(settings.ollama.baseUrl)
          .networkExposureRisk,
        warnings: [validateOllamaBaseUrlSecurity(settings.ollama.baseUrl).warning],
      },
    },
  };
}

export function useRuntimeHealth(
  settings: AIProviderSettings,
  profile: ModelProfileId,
  onSettingsChange: (settings: AIProviderSettings) => void
) {
  const [health, setHealth] = useState<RuntimeHealthState>(() =>
    baseHealth(settings, profile)
  );
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setHealth((current) => ({
      ...baseHealth(settings, profile),
      status: current.status === "degraded" ? current.status : baseHealth(settings, profile).status,
      message:
        current.status === "degraded"
          ? current.message
          : baseHealth(settings, profile).message,
    }));
  }, [profile, settings]);

  const testRuntime = useCallback(async () => {
    setChecking(true);
    const baseUrl = settings.ollama.baseUrl.replace(/\/$/, "");
    const checkedAt = new Date().toISOString();
    try {
      const baseUrlSecurity = validateOllamaBaseUrlSecurity(baseUrl);
      if (!baseUrlSecurity.allowed) {
        throw new Error(baseUrlSecurity.warning);
      }
      const [versionResponse, tagsResponse] = await Promise.all([
        fetchWithTimeout(`${baseUrl}/api/version`, {}, 5000),
        fetchWithTimeout(`${baseUrl}/api/tags`, {}, 7000),
      ]);
      if (!versionResponse.ok || !tagsResponse.ok) {
        throw new Error(`Ollama returned ${versionResponse.status}/${tagsResponse.status}`);
      }
      const tags = (await tagsResponse.json()) as {
        version?: string;
        models?: Array<{ name: string; size?: number; modified_at?: string }>;
      };
      const version = (await versionResponse.json().catch(() => ({}))) as { version?: string };
      const installed =
        tags.models?.map((model) => {
          const normalizedName = normalizeOllamaModelId(model.name);
          return {
            id: normalizedName,
            name: normalizedName,
            provider: "ollama" as const,
            installed: true,
            size: model.size ? `${Math.round(model.size / 1024 / 1024)} MB` : undefined,
            modifiedAt: model.modified_at,
            location: settings.ollama.modelLocation,
          };
        }) ?? [];
      const nextSettings: AIProviderSettings = reconcileModelProfiles({
        ...settings,
        ollama: {
          ...settings.ollama,
          models: mergeOllamaModels(installed),
          lastConnectionStatus: "connected",
          lastCheckedAt: checkedAt,
        },
      });
      onSettingsChange(nextSettings);
      const selectedModel = getProfileModel(nextSettings, profile);
      const nextHealth: RuntimeHealthState = {
        ollama_installed: true,
        ollama_running: true,
        models_available: installed.length > 0,
        selected_model_ready: Boolean(selectedModel.installed),
        status: "ready",
        message:
          installed.length > 0
            ? runtimeHealthMessage("ready", settings.ollama.baseUrl)
            : "Ollama is running. Pull a model before sending prompts.",
        checkedAt,
        ollama: {
          runtimeReachable: true,
          version: version.version,
          tagsReachable: true,
          availableModels: installed.map((model) => model.id),
          selectedModelAvailable: Boolean(selectedModel.installed),
          lastCheckedAt: checkedAt,
          stale: false,
          security: {
            localOnly: baseUrlSecurity.localOnly,
            networkExposureRisk: baseUrlSecurity.networkExposureRisk,
            versionStatus: ollamaVersionSecurityStatus(version.version),
            warnings:
              ollamaVersionSecurityStatus(version.version) === "vulnerable"
                ? ["Ollama version may be vulnerable. Update to 0.17.1 or newer."]
                : [baseUrlSecurity.warning],
          },
        },
      };
      setHealth(nextHealth);
      return nextHealth;
    } catch (error) {
      const status = mapOllamaError(error);
      const baseUrlSecurity = validateOllamaBaseUrlSecurity(settings.ollama.baseUrl);
      const nextSettings: AIProviderSettings = {
        ...settings,
        ollama: {
          ...settings.ollama,
          lastConnectionStatus: "offline",
          lastCheckedAt: checkedAt,
        },
      };
      onSettingsChange(nextSettings);
      const nextHealth: RuntimeHealthState = {
        ollama_installed: false,
        ollama_running: false,
        models_available: false,
        selected_model_ready: false,
        status,
        message: runtimeHealthMessage(status, settings.ollama.baseUrl),
        checkedAt,
        ollama: {
          runtimeReachable: false,
          tagsReachable: false,
          availableModels: [],
          selectedModelAvailable: false,
          lastCheckedAt: checkedAt,
          lastErrorKind: status === "not_running" ? "runtime_unavailable" : "unknown",
          stale: false,
          security: {
            localOnly: baseUrlSecurity.localOnly,
            networkExposureRisk: baseUrlSecurity.networkExposureRisk,
            versionStatus: "unavailable",
            warnings: [error instanceof Error ? error.message : baseUrlSecurity.warning],
          },
        },
      };
      setHealth(nextHealth);
      return nextHealth;
    } finally {
      setChecking(false);
    }
  }, [onSettingsChange, profile, settings]);

  const selectedModel = useMemo(() => getProfileModel(settings, profile), [profile, settings]);

  return {
    ...health,
    checking,
    selectedModel,
    testRuntime,
  };
}
