import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchWithTimeout,
  getProfileModel,
  mapOllamaError,
  mergeOllamaModels,
  runtimeHealthMessage,
  type AIProviderSettings,
  type ModelProfileId,
  type RuntimeHealthState,
} from "../services/modelProviders";

function baseHealth(settings: AIProviderSettings, profile: ModelProfileId): RuntimeHealthState {
  const selectedModel = getProfileModel(settings, profile);
  const installedModels = settings.ollama.models.filter((model) => model.installed);
  return {
    ollama_installed: settings.ollama.lastConnectionStatus === "connected",
    ollama_running: settings.ollama.lastConnectionStatus === "connected",
    models_available: installedModels.length > 0,
    selected_model_ready: Boolean(selectedModel.installed),
    status: settings.ollama.lastConnectionStatus === "connected" ? "ready" : "unknown",
    message: runtimeHealthMessage(
      settings.ollama.lastConnectionStatus === "connected" ? "ready" : "unknown",
      settings.ollama.baseUrl
    ),
    checkedAt: settings.ollama.lastCheckedAt,
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
      const [versionResponse, tagsResponse] = await Promise.all([
        fetchWithTimeout(`${baseUrl}/api/version`, {}, 5000),
        fetchWithTimeout(`${baseUrl}/api/tags`, {}, 7000),
      ]);
      if (!versionResponse.ok || !tagsResponse.ok) {
        throw new Error(`Ollama returned ${versionResponse.status}/${tagsResponse.status}`);
      }
      const tags = (await tagsResponse.json()) as {
        models?: Array<{ name: string; size?: number; modified_at?: string }>;
      };
      const installed =
        tags.models?.map((model) => ({
          id: model.name,
          name: model.name,
          provider: "ollama" as const,
          installed: true,
          size: model.size ? `${Math.round(model.size / 1024 / 1024)} MB` : undefined,
          modifiedAt: model.modified_at,
          location: settings.ollama.modelLocation,
        })) ?? [];
      const nextSettings: AIProviderSettings = {
        ...settings,
        ollama: {
          ...settings.ollama,
          models: mergeOllamaModels(installed),
          lastConnectionStatus: "connected",
          lastCheckedAt: checkedAt,
        },
      };
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
      };
      setHealth(nextHealth);
      return nextHealth;
    } catch (error) {
      const status = mapOllamaError(error);
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
