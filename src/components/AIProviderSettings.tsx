import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  Download,
  Info,
  KeyRound,
  Palette,
  ShieldCheck,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  SlidersHorizontal,
  Workflow,
  X,
} from "lucide-react";
import {
  canUseMockResponseMode,
  defaultAIProviderSettings,
  getProfileModel,
  isMockResponseModeEnabled,
  mergeOllamaModels,
  OLLAMA_LOCAL_PROVIDER_PROFILE_ID,
  validateOllamaBaseUrlSecurity,
  type AIProviderSettings,
  type ModelDescriptor,
  type ModelProviderKind,
  type ModelProfileId,
  type RuntimeHealthState,
} from "../services/modelProviders";
import {
  isMockDataForced,
  type AccessibilitySettings,
  type AppSettings,
  type MemorySettings,
  type MessageCollapseSettings,
  type NotificationSettings,
  type StartupSettings,
} from "../services/appSettings";
import {
  displayKeyLabel,
  keyboardShortcutDefinitions,
  shortcutKeysForPlatform,
  type ShortcutPlatform,
  type KeyboardShortcutDefinition,
} from "../services/keyboardShortcuts";
import {
  getElectronRuntimeBridge,
  getElectronRuntimeInfo,
  logElectronEvent,
  type LoomDesktopRuntimeStatus,
} from "../electronRuntime";
import { transcodeRecordedAudioToPcmWav } from "../services/audioWav";
import { speechTranscriptionErrorMessage } from "../hooks/useSpeechToTextRecorder";
import type {
  CapabilitySummary,
  LoomEngineClient,
  LoomServiceRuntimeConfig,
  OcrProviderHealth,
  OcrRuntimeConfig,
  ProviderProfileRuntimeConfig,
  ProviderSecretStatus,
  RuntimeModelDownloadJob,
  RuntimeModelProviderStatus,
  RuntimeModelsResult,
  ServiceConfigStatus,
  ServiceHealthStatus,
  SpeechProviderHealth,
  SpeechSetupStatus,
  SpeechToTextProviderKind,
  SpeechToTextRuntimeConfig,
} from "../engine";
import {
  canEnableProviderProfile,
  canSelectProviderProfileForMain,
  isRemoteProviderProfile,
  providerProfileBadges,
  providerProfileAccessLabel,
  providerSecretStatusLabel,
} from "../services/providerProfiles";

export type SettingsCategoryId =
  | "runtime"
  | "ai-providers"
  | "models"
  | "capability"
  | "context-memory"
  | "privacy-security"
  | "data-storage"
  | "export-import"
  | "ui-preferences"
  | "shortcuts"
  | "advanced";

const settingsCategories: Array<{
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: typeof Workflow;
}> = [
  { id: "runtime", label: "Runtime", description: "Service health and runtime readiness", icon: Workflow },
  { id: "ai-providers", label: "Providers", description: "Connection, endpoint safety, availability", icon: Server },
  { id: "models", label: "Models", description: "Quick/Main selection and availability", icon: Bot },
  { id: "capability", label: "Capability", description: "Local capability and safe strategy", icon: SlidersHorizontal },
  { id: "context-memory", label: "Memory", description: "Recent Looms, saved memories, profile", icon: Workflow },
  { id: "privacy-security", label: "Privacy & Security", description: "Local-first and raw-thinking protections", icon: ShieldCheck },
  { id: "data-storage", label: "Data & Storage", description: "SQLite and local data", icon: Database },
  { id: "export-import", label: "Export / Import", description: "Portable Loom data", icon: Download },
  { id: "ui-preferences", label: "UI Preferences", description: "Display and comfort", icon: Palette },
  { id: "shortcuts", label: "Shortcuts", description: "Browser-style keyboard commands", icon: Search },
  { id: "advanced", label: "Advanced", description: "Diagnostics, config, developer plans", icon: Info },
];

const defaultSpeechConfigDraft: SpeechToTextRuntimeConfig = {
  enabled: true,
  defaultProviderKind: "local_command",
  allowCloudStt: false,
  persistAudio: false,
  persistTranscript: false,
  maxAudioBytes: 10 * 1024 * 1024,
  allowedMimeTypes: [
    "audio/webm",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
  ],
  defaultLanguage: null,
  providerProfileId: null,
  localCommandPath: null,
  localCommandArgs: ["-m", "/path/to/ggml-base.en.bin", "-f", "{input}", "-otxt", "-of", "{output}"],
  localCommandTimeoutMs: 120_000,
  localTempDir: null,
  localCommandOutputMode: "file",
  localCommandTranscriptFileExtension: "txt",
  warnings: [],
};

const defaultOcrConfigDraft: OcrRuntimeConfig = {
  enabled: false,
  provider: "tesseract",
  commandPath: null,
  pdfRasterizerCommandPath: null,
  language: "eng",
  dpi: 200,
  timeoutSeconds: 60,
  maxPagesPerFile: 20,
  maxImagePixels: 24_000_000,
  tempDir: null,
};

function speechArgsText(args: string[]) {
  return args.join("\n");
}

function speechSetupGuidance(status: SpeechSetupStatus | null) {
  switch (status?.state) {
    case "whisper_not_found":
      return "Local Speech Engine is not installed. Open Settings → Capability → Speech-to-Text and install the local speech engine.";
    case "model_missing":
      return "Local Speech Engine is installed, but no speech model is available. Open Settings → Capability → Speech-to-Text and download/select a model.";
    case "model_ready":
      return "Speech-to-Text is not configured yet. Open Settings → Capability → Speech-to-Text and run Auto-configure.";
    case "ready":
      return "Speech-to-Text is configured, but the local command failed. Open Settings → Capability → Speech-to-Text and run Check Provider.";
    default:
      return "Speech-to-Text is not configured yet. Open Settings → Capability → Speech-to-Text and run Auto-configure.";
  }
}

function speechProviderHealthMessage(health: SpeechProviderHealth, setup: SpeechSetupStatus | null) {
  const legacyMissingCommand = health.message
    .toLowerCase()
    .includes("local speech-to-text provider is not configured");
  if (health.status === "missing_command" || legacyMissingCommand) {
    return speechSetupGuidance(setup);
  }
  return health.message;
}

function parseSpeechArgs(value: string) {
  return value
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function runtimeStatusLabel(status?: string) {
  if (!status) return "Not available";
  if (status === "unknown") return "Connection not tested";
  if (status === "not_running") return "Offline";
  if (status === "degraded") return "Needs attention";
  if (status === "ready") return "Connected";
  return status
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function providerPillLabel(status: AIProviderSettings["ollama"]["lastConnectionStatus"]) {
  if (status === "connected") return "connected";
  if (status === "offline") return "offline";
  return "not tested";
}

function securityAccessLabel(
  security:
    | {
        localOnly?: boolean;
        networkExposureRisk?: string;
      }
    | undefined,
  baseUrl: string
) {
  const baseUrlSecurity = validateOllamaBaseUrlSecurity(baseUrl);
  const localOnly = security?.localOnly ?? baseUrlSecurity.localOnly;
  const exposure = security?.networkExposureRisk ?? baseUrlSecurity.networkExposureRisk;
  if (!localOnly) return "Remote access blocked by default";
  if (exposure === "high") return "Network exposure blocked";
  if (exposure === "low") return "Local-only access enabled";
  return "Local access target is invalid";
}

function providerVersionLabel(versionStatus?: string) {
  if (versionStatus === "ok") return "Version check OK";
  if (versionStatus === "vulnerable") return "Update recommended";
  if (versionStatus === "unavailable") return "Version unavailable while provider is offline";
  return "Version not checked yet";
}

function formatModelBytes(value?: number | null) {
  if (!value || value <= 0) return undefined;
  if (value > 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (value > 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function descriptorsFromRuntimeModels(runtimeModels: RuntimeModelsResult): ModelDescriptor[] {
  return runtimeModels.models.map((model) => ({
    id: model.modelName,
    name: model.displayName,
    provider: "ollama",
    installed: model.installed,
    size: formatModelBytes(model.sizeBytes),
    location: model.localPath ?? runtimeModels.provider.modelStorePath,
  }));
}

export function AIProviderSettingsModal({
  settings,
  appSettings,
  runtimeHealth,
  engineClient,
  onSave,
  onAppSettingsSave,
  onClose,
  onResetAllData,
  initialCategory = "runtime",
}: {
  settings: AIProviderSettings;
  appSettings: AppSettings;
  runtimeHealth: RuntimeHealthState & {
    checking: boolean;
    testRuntime: () => Promise<RuntimeHealthState>;
  };
  engineClient: LoomEngineClient;
  onSave: (settings: AIProviderSettings) => void;
  onAppSettingsSave: (settings: AppSettings) => void;
  onClose: () => void;
  onResetAllData?: () => Promise<void>;
  initialCategory?: SettingsCategoryId;
}) {
  const [draft, setDraft] = useState(settings);
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(initialCategory);
  const [query, setQuery] = useState("");
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState<"idle" | "confirming" | "working">("idle");
  const [serviceStatus, setServiceStatus] = useState<{
    health?: ServiceHealthStatus;
    config?: ServiceConfigStatus;
    serviceConfig?: LoomServiceRuntimeConfig;
    configError?: string;
    speechHealth?: SpeechProviderHealth;
    speechHealthError?: string;
    ocrHealth?: OcrProviderHealth;
    ocrHealthError?: string;
    capability?: CapabilitySummary;
    loading: boolean;
  }>({ loading: false });
  const [desktopRuntimeStatus, setDesktopRuntimeStatus] =
    useState<LoomDesktopRuntimeStatus | null>(null);
  const [desktopRuntimeWorking, setDesktopRuntimeWorking] = useState(false);
  const [desktopRuntimeMessage, setDesktopRuntimeMessage] = useState<string | null>(null);
  const [speechDraft, setSpeechDraft] = useState<SpeechToTextRuntimeConfig>(
    defaultSpeechConfigDraft
  );
  const [ocrDraft, setOcrDraft] = useState<OcrRuntimeConfig>(defaultOcrConfigDraft);
  const [memoryDraft, setMemoryDraft] = useState<MemorySettings>(appSettings.memory);
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelsResult | null>(null);
  const [runtimeProviderStatuses, setRuntimeProviderStatuses] = useState<
    Record<string, RuntimeModelProviderStatus>
  >({});
  const [downloadJobs, setDownloadJobs] = useState<Record<string, RuntimeModelDownloadJob>>({});
  const [speechSetup, setSpeechSetup] = useState<SpeechSetupStatus | null>(null);
  const [speechSetupWorking, setSpeechSetupWorking] = useState<string | null>(null);
  const [providerSecretStatuses, setProviderSecretStatuses] = useState<
    Record<string, ProviderSecretStatus>
  >({});
  const [providerSecretDrafts, setProviderSecretDrafts] = useState<Record<string, string>>({});
  const [providerPrivacyAcknowledged, setProviderPrivacyAcknowledged] = useState<
    Record<string, boolean>
  >({});
  const [providerProfileWorking, setProviderProfileWorking] = useState<string | null>(null);
  const [speechSmoke, setSpeechSmoke] = useState<{
    status: "idle" | "recording" | "transcribing" | "success" | "error";
    message: string;
    transcript?: string;
  }>({ status: "idle", message: "Record a short sample after setup is ready." });

  const [localDiscoveryState, setLocalDiscoveryState] = useState<Record<string, {
    status: "idle" | "discovering" | "success" | "disabled" | "missing_secret" | "unauthorized" | "rate_limited" | "unavailable" | "invalid_response" | "invalid_config" | "feature_gated" | "provider_error" | "error";
    models: string[];
    message?: string;
  }>>({});

  function getDiscoveredModelsForProfile(
    profileId: string,
    capabilityModels?: Array<{ source?: string; modelId?: string; modelName: string }>
  ): string[] {
    if (!capabilityModels) return [];
    const list: string[] = [];
    for (const model of capabilityModels) {
      if (model.source === "provider_discovery" && model.modelId?.startsWith("provider_discovery:")) {
        const parts = model.modelId.split(":");
        if (parts[2] === profileId && parts[3]) {
          const modelName = parts.slice(3).join(":");
          list.push(modelName);
        }
      }
    }
    return list;
  }

  async function discoverModelsForProfile(profile: ProviderProfileRuntimeConfig) {
    if (!profile.enabled) {
      setLocalDiscoveryState((current) => ({
        ...current,
        [profile.id]: { status: "disabled", models: [] },
      }));
      return;
    }
    const secretStatus = providerSecretStatuses[profile.id];
    if (profile.requiresSecret && !secretStatus?.present) {
      setLocalDiscoveryState((current) => ({
        ...current,
        [profile.id]: { status: "missing_secret", models: [] },
      }));
      return;
    }

    setLocalDiscoveryState((current) => ({
      ...current,
      [profile.id]: { status: "discovering", models: [] },
    }));

    try {
      const response = await engineClient.discoverModels({
        providerProfileId: profile.id,
        persist: true,
      });

      const profileError = response.errors.find((err) => err.providerProfileId === profile.id);
      if (profileError) {
        const validKinds = [
          "disabled",
          "missing_secret",
          "unauthorized",
          "rate_limited",
          "unavailable",
          "invalid_response",
          "invalid_config",
          "feature_gated",
          "provider_error",
        ];
        const status = validKinds.includes(profileError.kind)
          ? (profileError.kind as any)
          : "provider_error";
        setLocalDiscoveryState((current) => ({
          ...current,
          [profile.id]: {
            status,
            models: [],
            message: profileError.message,
          },
        }));
        return;
      }

      const models = response.discovered
        .filter((item) => item.providerProfileId === profile.id)
        .map((item) => item.modelName);

      setLocalDiscoveryState((current) => ({
        ...current,
        [profile.id]: {
          status: "success",
          models,
        },
      }));

      await refreshServiceStatus();
    } catch (error) {
      setLocalDiscoveryState((current) => ({
        ...current,
        [profile.id]: {
          status: "error",
          models: [],
          message: error instanceof Error ? error.message : "Discovery request failed.",
        },
      }));
    }
  }

  async function selectDiscoveredModel(profile: ProviderProfileRuntimeConfig, modelName: string) {
    const secretStatus = providerSecretStatuses[profile.id];
    const runtimeProviderStatus = runtimeProviderStatuses[profile.id];
    const gate = canSelectProviderProfileForMain(
      profile,
      secretStatus,
      runtimeProviderStatus,
      providerPrivacyAcknowledged[profile.id] ?? false
    );
    if (!gate.allowed) {
      setMessage(gate.reason ?? "This provider cannot be used for Main yet.");
      return;
    }
    setProviderProfileWorking(`${profile.id}:main`);
    setMessage(null);
    try {
      const result = await engineClient.updateServiceConfig({
        providers: {
          defaultQuickModel:
            serviceStatus.serviceConfig?.providers?.defaultQuickModel ??
            draft.profiles.quickModelId,
          defaultMainModel: modelName,
          mainProviderProfileId: profile.id,
          mainModelId: modelName,
        },
      });
      setServiceStatus((current) => ({ ...current, serviceConfig: result.config }));
      setDraft((current) => ({
        ...current,
        profiles: {
          ...current.profiles,
          mainModelId: modelName,
          mainProviderProfileId: profile.id,
          mainProviderDisplayName: profile.displayName,
          mainProviderKind: modelProviderKindForProfile(profile),
        },
      }));
      onSave({
        ...draft,
        profiles: {
          ...draft.profiles,
          mainModelId: modelName,
          mainProviderProfileId: profile.id,
          mainProviderDisplayName: profile.displayName,
          mainProviderKind: modelProviderKindForProfile(profile),
        },
      });
      setMessage(`Selected model ${modelName} for ${profile.displayName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Model selection could not be saved.");
    } finally {
      setProviderProfileWorking(null);
    }
  }

  const desktopRuntimeInfo = getElectronRuntimeInfo();
  const desktopRuntimeBridge = getElectronRuntimeBridge();


  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    setMemoryDraft(appSettings.memory);
  }, [appSettings.memory]);

  async function refreshServiceStatus() {
    setServiceStatus((current) => ({ ...current, loading: true }));
    const [
      health,
      config,
      capability,
      speechHealthResult,
      ocrHealthResult,
      serviceConfigResult,
      runtimeProvidersResult,
    ] = await Promise.all([
      engineClient.getServiceHealth(),
      engineClient.getServiceConfigStatus(),
      engineClient.getCapabilitySummary(),
      engineClient
        .getSpeechProviderHealth()
        .then((speechHealth) => ({ speechHealth }))
        .catch((error: unknown) => ({
          speechHealthError:
            error instanceof Error ? error.message : "speech provider health is unavailable.",
        })),
      engineClient
        .getOcrProviderHealth()
        .then((ocrHealth) => ({ ocrHealth }))
        .catch((error: unknown) => ({
          ocrHealthError:
            error instanceof Error ? error.message : "OCR provider health is unavailable.",
        })),
      engineClient
        .getServiceConfig()
        .then((serviceConfig) => ({ serviceConfig }))
        .catch((error: unknown) => ({
          configError:
            error instanceof Error ? error.message : "loom-service config is unavailable.",
        })),
      engineClient
        .getRuntimeProviders()
        .then((runtimeProviders) => ({ runtimeProviders }))
        .catch((error: unknown) => ({
          runtimeProvidersError:
            error instanceof Error ? error.message : "provider runtime status is unavailable.",
        })),
    ]);
    if ("runtimeProviders" in runtimeProvidersResult) {
      setRuntimeProviderStatuses(
        Object.fromEntries(
          runtimeProvidersResult.runtimeProviders.map((provider) => [
            provider.providerProfileId,
            provider,
          ])
        )
      );
    }
    setServiceStatus({
      health,
      config,
      capability,
      serviceConfig: "serviceConfig" in serviceConfigResult ? serviceConfigResult.serviceConfig : undefined,
      configError: "configError" in serviceConfigResult ? serviceConfigResult.configError : undefined,
      speechHealth: "speechHealth" in speechHealthResult ? speechHealthResult.speechHealth : undefined,
      speechHealthError:
        "speechHealthError" in speechHealthResult ? speechHealthResult.speechHealthError : undefined,
      ocrHealth: "ocrHealth" in ocrHealthResult ? ocrHealthResult.ocrHealth : undefined,
      ocrHealthError:
        "ocrHealthError" in ocrHealthResult ? ocrHealthResult.ocrHealthError : undefined,
      loading: false,
    });
  }

  async function refreshProviderSecretStatuses(profiles: ProviderProfileRuntimeConfig[]) {
    const secretProfiles = profiles.filter((profile) => profile.requiresSecret);
    if (secretProfiles.length === 0) {
      setProviderSecretStatuses({});
      return;
    }
    const entries = await Promise.all(
      secretProfiles.map(async (profile): Promise<[string, ProviderSecretStatus]> => {
        try {
          const status = await engineClient.getProviderSecretStatus(profile.id);
          return [profile.id, status];
        } catch {
          return [
            profile.id,
            {
              providerProfileId: profile.id,
              secretRef: profile.secretRef ?? "",
              present: false,
              status: "unavailable",
            },
          ];
        }
      })
    );
    setProviderSecretStatuses(Object.fromEntries(entries));
  }

  async function refreshDesktopRuntimeStatus() {
    if (!desktopRuntimeBridge) {
      setDesktopRuntimeStatus({
        state: "unavailable",
        startedByElectron: false,
      });
      return;
    }
    const status = await desktopRuntimeBridge.status();
    setDesktopRuntimeStatus(status);
  }

  async function restartDesktopRuntime() {
    if (!desktopRuntimeBridge) return;
    setDesktopRuntimeWorking(true);
    setDesktopRuntimeMessage("Restarting local runtime...");
    try {
      const status = await desktopRuntimeBridge.restart();
      setDesktopRuntimeStatus(status);
      setDesktopRuntimeMessage("Local runtime restarted.");
      await refreshServiceStatus();
    } catch (error) {
      setDesktopRuntimeMessage(
        error instanceof Error ? error.message : "Local runtime restart failed."
      );
    } finally {
      setDesktopRuntimeWorking(false);
    }
  }

  useEffect(() => {
    if (serviceStatus.serviceConfig?.speech) {
      setSpeechDraft(serviceStatus.serviceConfig.speech);
    }
    if (serviceStatus.serviceConfig?.ocr) {
      setOcrDraft(serviceStatus.serviceConfig.ocr);
    }
    if (serviceStatus.serviceConfig?.providers) {
      const serviceProviders = serviceStatus.serviceConfig.providers;
      const mainProviderProfileId =
        serviceProviders.mainProviderProfileId ?? OLLAMA_LOCAL_PROVIDER_PROFILE_ID;
      const mainProviderProfile = serviceProviders.profiles?.find(
        (profile) => profile.id === mainProviderProfileId
      );
      setDraft((current) => ({
        ...current,
        profiles: {
          ...current.profiles,
          quickModelId: serviceProviders.defaultQuickModel ?? current.profiles.quickModelId,
          mainModelId:
            serviceProviders.mainModelId ??
            serviceProviders.defaultMainModel ??
            current.profiles.mainModelId,
          mainProviderProfileId,
          mainProviderDisplayName:
            mainProviderProfile?.displayName ??
            (mainProviderProfileId === OLLAMA_LOCAL_PROVIDER_PROFILE_ID
              ? "Ollama Local"
              : mainProviderProfileId),
          mainProviderKind: mainProviderProfile
            ? modelProviderKindForProfile(mainProviderProfile)
            : mainProviderProfileId === OLLAMA_LOCAL_PROVIDER_PROFILE_ID
              ? "ollama"
              : "openai-compatible",
        },
      }));
    }
  }, [serviceStatus.serviceConfig]);

  useEffect(() => {
    if (
      ["runtime", "ai-providers", "capability", "advanced"].includes(activeCategory) &&
      !serviceStatus.health &&
      !serviceStatus.loading
    ) {
      void refreshServiceStatus();
    }
  }, [activeCategory, serviceStatus.health, serviceStatus.loading]);

  useEffect(() => {
    if (activeCategory !== "ai-providers") return;
    const profiles = serviceStatus.serviceConfig?.providers?.profiles ?? [];
    void refreshProviderSecretStatuses(profiles);
  }, [activeCategory, serviceStatus.serviceConfig?.providers?.profiles]);

  useEffect(() => {
    if (activeCategory !== "runtime" && activeCategory !== "advanced") return;
    void refreshDesktopRuntimeStatus();
  }, [activeCategory]);

  useEffect(() => {
    if (activeCategory === "capability" && !speechSetup && !speechSetupWorking) {
      void refreshSpeechSetupStatus();
    }
  }, [activeCategory, speechSetup, speechSetupWorking]);

  useEffect(() => {
    if (activeCategory === "models" && !runtimeModels && working !== "refresh") {
      void refreshModels();
    }
  }, [activeCategory, runtimeModels, working]);

  const filteredModels = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return draft.ollama.models;
    return draft.ollama.models.filter((model) =>
      [model.name, model.id, model.provider, model.location]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [draft.ollama.models, query]);

  function update(next: AIProviderSettings) {
    setDraft(next);
    onSave(next);
  }

  function updateAppSettings(next: AppSettings) {
    onAppSettingsSave(next);
  }

  function updateNotificationSettings(next: NotificationSettings) {
    updateAppSettings({ ...appSettings, notifications: next });
  }

  function updateStartupSettings(next: StartupSettings) {
    updateAppSettings({ ...appSettings, startup: next });
  }

  function updateAccessibilitySettings(next: AccessibilitySettings) {
    updateAppSettings({ ...appSettings, accessibility: next });
  }

  function updateMessageCollapseSettings(next: MessageCollapseSettings) {
    updateAppSettings({ ...appSettings, messageCollapse: next });
  }

  function modelProviderKindForProfile(
    profile: ProviderProfileRuntimeConfig
  ): ModelProviderKind {
    if (profile.providerKind === "ollama") return "ollama";
    if (profile.providerKind === "openai_compatible") return "openai-compatible";
    return "openai-compatible";
  }

  function updateMemoryDraft(patch: Partial<MemorySettings>) {
    setMemoryDraft((current) => ({ ...current, ...patch }));
  }

  async function saveMemorySettings() {
    updateAppSettings({ ...appSettings, memory: memoryDraft });
    if (serviceStatus.serviceConfig) {
      try {
        const result = await engineClient.updateServiceConfig({
          memory: {
            enabled: memoryDraft.enabled,
            referenceRecentLooms: memoryDraft.referenceRecentLooms,
            referenceSavedMemories: memoryDraft.referenceSavedMemories,
            nickname: memoryDraft.nickname,
            occupation: memoryDraft.occupation,
            stylePreferences: memoryDraft.stylePreferences,
            moreAboutYou: memoryDraft.moreAboutYou,
          },
        });
        setServiceStatus((current) => ({
          ...current,
          serviceConfig: result.config,
          configError: undefined,
          config: current.config
            ? {
                ...current.config,
                restartRequired: result.restartStatus?.restartRequired,
                pendingRestart: result.restartStatus?.pendingRestart,
              }
            : current.config,
        }));
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Memory settings could not be saved to loom-service."
        );
        return;
      }
    }
    setMessage("Memory settings saved.");
  }

  function resetMemorySettings() {
    setMemoryDraft(appSettings.memory);
    setMessage(null);
  }

  async function testConnection() {
    setWorking("test");
    setMessage(null);
    try {
      const health = await runtimeHealth.testRuntime();
      setMessage(health.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ollama connection failed.");
    } finally {
      setWorking(null);
    }
  }

  async function refreshModels() {
    setWorking("refresh");
    setMessage(null);
    try {
      const result = await engineClient.getRuntimeModels();
      setRuntimeModels(result);
      setDownloadJobs(Object.fromEntries(result.jobs.map((job) => [job.jobId, job])));
      const models = mergeOllamaModels(descriptorsFromRuntimeModels(result));
      update({
        ...draft,
        ollama: {
          ...draft.ollama,
          models,
          lastConnectionStatus: "connected",
          lastCheckedAt: new Date().toISOString(),
        },
      });
      setMessage("Model list refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh models.");
    } finally {
      setWorking(null);
    }
  }

  async function pullModel(model: ModelDescriptor) {
    setWorking(model.id);
    setMessage(null);
    try {
      const job = await engineClient.startModelDownload(model.id);
      setDownloadJobs((current) => ({ ...current, [job.jobId]: job }));
      setMessage(`${model.name} download started.`);
      void pollModelDownload(job.jobId, model.name);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not download ${model.name}.`);
    } finally {
      setWorking(null);
    }
  }

  async function pollModelDownload(jobId: string, modelName: string) {
    let lastJob: RuntimeModelDownloadJob | undefined;
    for (let attempt = 0; attempt < 720; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      try {
        const job = await engineClient.getModelDownload(jobId);
        lastJob = job;
        setDownloadJobs((current) => ({ ...current, [job.jobId]: job }));
        if (["installed", "failed", "cancelled"].includes(job.status)) break;
      } catch {
        break;
      }
    }
    if (lastJob?.status === "installed") {
      const result = await engineClient.getRuntimeModels();
      setRuntimeModels(result);
      update({ ...draft, ollama: { ...draft.ollama, models: mergeOllamaModels(descriptorsFromRuntimeModels(result)) } });
      setMessage(`${modelName} is installed.`);
    } else if (lastJob?.status === "cancelled") {
      setMessage(`${modelName} download cancelled.`);
    } else if (lastJob?.status === "failed") {
      setMessage(lastJob.error ?? `${modelName} download failed.`);
    }
  }

  async function cancelModelDownload(jobId: string) {
    try {
      const job = await engineClient.cancelModelDownload(jobId);
      setDownloadJobs((current) => ({ ...current, [job.jobId]: job }));
      setMessage("Model download cancellation requested.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel model download.");
    }
  }

  function setProfile(profile: ModelProfileId, modelId: string) {
    if (profile === "quick") {
      const next = {
        ...draft,
        profiles: {
          ...draft.profiles,
          quickModelId: modelId,
        },
      };
      update(next);
      void persistModelProfiles(next);
      return;
    }

    const isOllamaModel = draft.ollama.models.some((m) => m.id === modelId);
    const newProviderProfileId = isOllamaModel
      ? OLLAMA_LOCAL_PROVIDER_PROFILE_ID
      : (currentMainProviderProfileId ?? OLLAMA_LOCAL_PROVIDER_PROFILE_ID);

    const isOllama = newProviderProfileId === OLLAMA_LOCAL_PROVIDER_PROFILE_ID;
    const activeProfile = isOllama
      ? null
      : serviceStatus.serviceConfig?.providers?.profiles?.find(
          (p) => p.id === newProviderProfileId
        );

    const next = {
      ...draft,
      profiles: {
        ...draft.profiles,
        mainModelId: modelId,
        mainProviderProfileId: newProviderProfileId,
        mainProviderDisplayName: isOllama
          ? "Ollama Local"
          : activeProfile?.displayName ?? newProviderProfileId,
        mainProviderKind: isOllama
          ? ("ollama" as const)
          : activeProfile
            ? modelProviderKindForProfile(activeProfile)
            : ("openai-compatible" as const),
      },
    };
    update(next);
    void persistModelProfiles(next);
  }

  async function persistModelProfiles(next: AIProviderSettings) {
    try {
      const result = await engineClient.updateServiceConfig({
        providers: {
          defaultQuickModel: next.profiles.quickModelId,
          defaultMainModel: next.profiles.mainModelId,
          mainProviderProfileId: next.profiles.mainProviderProfileId,
          mainModelId: next.profiles.mainModelId,
        },
      });
      setServiceStatus((current) => ({ ...current, serviceConfig: result.config }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Model assignment could not be saved.");
    }
  }

  async function selectProviderProfileForMain(profile: ProviderProfileRuntimeConfig) {
    const secretStatus = providerSecretStatuses[profile.id];
    const runtimeProviderStatus = runtimeProviderStatuses[profile.id];
    const gate = canSelectProviderProfileForMain(
      profile,
      secretStatus,
      runtimeProviderStatus,
      providerPrivacyAcknowledged[profile.id] ?? false
    );
    if (!gate.allowed) {
      setMessage(gate.reason ?? "This provider cannot be used for Main yet.");
      return;
    }
    const modelId = profile.defaultModel;
    if (!modelId) {
      setMessage("This provider does not have a default model configured.");
      return;
    }
    setProviderProfileWorking(`${profile.id}:main`);
    setMessage(null);
    try {
      const result = await engineClient.updateServiceConfig({
        providers: {
          defaultQuickModel:
            serviceStatus.serviceConfig?.providers?.defaultQuickModel ??
            draft.profiles.quickModelId,
          defaultMainModel: modelId,
          mainProviderProfileId: profile.id,
          mainModelId: modelId,
        },
      });
      setDraft((current) => ({
        ...current,
        profiles: {
          ...current.profiles,
          mainModelId: modelId,
          mainProviderProfileId: profile.id,
          mainProviderDisplayName: profile.displayName,
          mainProviderKind: modelProviderKindForProfile(profile),
        },
      }));
      onSave({
        ...draft,
        profiles: {
          ...draft.profiles,
          mainModelId: modelId,
          mainProviderProfileId: profile.id,
          mainProviderDisplayName: profile.displayName,
          mainProviderKind: modelProviderKindForProfile(profile),
        },
      });
      setServiceStatus((current) => ({
        ...current,
        serviceConfig: result.config,
        configError: undefined,
        config: current.config
          ? {
              ...current.config,
              restartRequired: result.restartStatus?.restartRequired,
              pendingRestart: result.restartStatus?.pendingRestart,
            }
          : current.config,
      }));
      setMessage(`${profile.displayName} selected for Main.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Main provider could not be selected.");
    } finally {
      setProviderProfileWorking(null);
    }
  }

  function updateProviderSecretDraft(profileId: string, value: string) {
    setProviderSecretDrafts((current) => ({ ...current, [profileId]: value }));
  }

  async function saveProviderSecret(profile: ProviderProfileRuntimeConfig) {
    const value = providerSecretDrafts[profile.id]?.trim() ?? "";
    if (!value) {
      setMessage("Enter an API key before saving.");
      return;
    }
    setProviderProfileWorking(`${profile.id}:secret-save`);
    setMessage(null);
    try {
      const status = await engineClient.setProviderSecret(profile.id, value, profile.secretRef);
      setProviderSecretStatuses((current) => ({ ...current, [profile.id]: status }));
      setProviderSecretDrafts((current) => ({ ...current, [profile.id]: "" }));
      setMessage(`${profile.displayName} API key saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API key could not be saved.");
    } finally {
      setProviderProfileWorking(null);
    }
  }

  async function removeProviderSecret(profile: ProviderProfileRuntimeConfig) {
    setProviderProfileWorking(`${profile.id}:secret-remove`);
    setMessage(null);
    try {
      const status = await engineClient.deleteProviderSecret(profile.id);
      setProviderSecretStatuses((current) => ({ ...current, [profile.id]: status }));
      setProviderSecretDrafts((current) => ({ ...current, [profile.id]: "" }));
      setMessage(`${profile.displayName} API key removed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API key could not be removed.");
    } finally {
      setProviderProfileWorking(null);
    }
  }

  async function testProviderSecret(profile: ProviderProfileRuntimeConfig) {
    setProviderProfileWorking(`${profile.id}:secret-test`);
    setMessage(null);
    try {
      const status = await engineClient.testProviderSecret(profile.id, profile.secretRef);
      setProviderSecretStatuses((current) => ({ ...current, [profile.id]: status }));
      setMessage(`${profile.displayName} key status: ${providerSecretStatusLabel(profile, status)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API key status could not be tested.");
    } finally {
      setProviderProfileWorking(null);
    }
  }

  async function setProviderProfileEnabled(
    profile: ProviderProfileRuntimeConfig,
    enabled: boolean
  ) {
    const profiles = serviceStatus.serviceConfig?.providers?.profiles ?? [];
    const status = providerSecretStatuses[profile.id];
    if (enabled) {
      const gate = canEnableProviderProfile(
        profile,
        status,
        providerPrivacyAcknowledged[profile.id] ?? false
      );
      if (!gate.allowed) {
        setMessage(gate.reason ?? "This provider cannot be enabled yet.");
        return;
      }
    }
    setProviderProfileWorking(`${profile.id}:enabled`);
    setMessage(null);
    try {
      const disablingSelectedMain =
        !enabled && serviceStatus.serviceConfig?.providers?.mainProviderProfileId === profile.id;
      const localMainModelId =
        draft.ollama.models.find((model) => model.installed)?.id ??
        draft.ollama.models[0]?.id ??
        defaultAIProviderSettings.profiles.mainModelId;
      const result = await engineClient.updateServiceConfig({
        providers: {
          defaultQuickModel: serviceStatus.serviceConfig?.providers?.defaultQuickModel,
          defaultMainModel: disablingSelectedMain
            ? localMainModelId
            : serviceStatus.serviceConfig?.providers?.defaultMainModel,
          mainProviderProfileId: disablingSelectedMain
            ? OLLAMA_LOCAL_PROVIDER_PROFILE_ID
            : serviceStatus.serviceConfig?.providers?.mainProviderProfileId,
          mainModelId: disablingSelectedMain
            ? localMainModelId
            : serviceStatus.serviceConfig?.providers?.mainModelId,
          profiles: profiles.map((item) =>
            item.id === profile.id ? { ...item, enabled } : item
          ),
        },
      });
      setServiceStatus((current) => ({
        ...current,
        serviceConfig: result.config,
        configError: undefined,
        config: current.config
          ? {
              ...current.config,
              restartRequired: result.restartStatus?.restartRequired,
              pendingRestart: result.restartStatus?.pendingRestart,
            }
            : current.config,
      }));
      if (disablingSelectedMain) {
        setDraft((current) => ({
          ...current,
          profiles: {
            ...current.profiles,
            mainModelId: localMainModelId,
            mainProviderProfileId: OLLAMA_LOCAL_PROVIDER_PROFILE_ID,
            mainProviderDisplayName: "Ollama Local",
            mainProviderKind: "ollama",
          },
        }));
        onSave({
          ...draft,
          profiles: {
            ...draft.profiles,
            mainModelId: localMainModelId,
            mainProviderProfileId: OLLAMA_LOCAL_PROVIDER_PROFILE_ID,
            mainProviderDisplayName: "Ollama Local",
            mainProviderKind: "ollama",
          },
        });
      }
      setMessage(`${profile.displayName} ${enabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Provider profile could not be updated.");
    } finally {
      setProviderProfileWorking(null);
    }
  }

  function resetDefaults() {
    update(defaultAIProviderSettings);
    setMessage("Provider settings reset.");
  }

  async function saveSpeechConfig() {
    setWorking("speech-config");
    setMessage(null);
    try {
      const localCommandPath = speechDraft.localCommandPath?.trim() || null;
      const localTempDir = speechDraft.localTempDir?.trim() || null;
      const localCommandArgs =
        speechDraft.localCommandArgs.length > 0
          ? speechDraft.localCommandArgs
          : defaultSpeechConfigDraft.localCommandArgs;
      const result = await engineClient.updateServiceConfig({
        speech: {
          enabled: speechDraft.defaultProviderKind !== "disabled",
          defaultProviderKind: speechDraft.defaultProviderKind,
          localCommandPath,
          localCommandArgs,
          localCommandTimeoutMs: speechDraft.localCommandTimeoutMs,
          localTempDir,
          localCommandOutputMode: speechDraft.localCommandOutputMode,
          localCommandTranscriptFileExtension:
            speechDraft.localCommandTranscriptFileExtension,
        },
      });
      setSpeechDraft(result.config.speech);
      setServiceStatus((current) => ({
        ...current,
        serviceConfig: result.config,
        configError: undefined,
        config: current.config
          ? {
              ...current.config,
              restartRequired: result.restartStatus?.restartRequired,
              pendingRestart: result.restartStatus?.pendingRestart,
            }
          : current.config,
      }));
      setMessage("Speech-to-text settings saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Speech-to-text settings could not be saved."
      );
    } finally {
      setWorking(null);
    }
  }

  async function checkOcrProvider() {
    setWorking("ocr-check");
    setMessage(null);
    try {
      const health = await engineClient.getOcrProviderHealth();
      setServiceStatus((current) => ({
        ...current,
        ocrHealth: health,
        ocrHealthError: undefined,
      }));
      setMessage(health.message);
    } catch (error) {
      setServiceStatus((current) => ({
        ...current,
        ocrHealthError: error instanceof Error ? error.message : "OCR provider health is unavailable.",
      }));
      setMessage(error instanceof Error ? error.message : "OCR provider health is unavailable.");
    } finally {
      setWorking(null);
    }
  }

  async function saveOcrConfig() {
    setWorking("ocr-config");
    setMessage(null);
    try {
      const result = await engineClient.updateServiceConfig({
        ocr: {
          enabled: ocrDraft.enabled,
          provider: ocrDraft.provider,
          commandPath: ocrDraft.commandPath?.trim() || null,
          pdfRasterizerCommandPath: ocrDraft.pdfRasterizerCommandPath?.trim() || null,
          language: ocrDraft.language.trim() || "eng",
          dpi: ocrDraft.dpi,
          timeoutSeconds: ocrDraft.timeoutSeconds,
          maxPagesPerFile: ocrDraft.maxPagesPerFile,
          maxImagePixels: ocrDraft.maxImagePixels,
          tempDir: ocrDraft.tempDir?.trim() || null,
        },
      });
      setOcrDraft(result.config.ocr ?? defaultOcrConfigDraft);
      const health = await engineClient.getOcrProviderHealth();
      setServiceStatus((current) => ({
        ...current,
        serviceConfig: result.config,
        ocrHealth: health,
        ocrHealthError: undefined,
        configError: undefined,
        config: current.config
          ? {
              ...current.config,
              restartRequired: result.restartStatus?.restartRequired,
              pendingRestart: result.restartStatus?.pendingRestart,
            }
          : current.config,
      }));
      setMessage("OCR settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OCR settings could not be saved.");
    } finally {
      setWorking(null);
    }
  }

  async function refreshSpeechSetupStatus() {
    setSpeechSetupWorking("check");
    try {
      const status = await engineClient.getSpeechSetupStatus();
      setSpeechSetup(status);
      setMessage(status.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check Speech-to-Text setup.");
    } finally {
      setSpeechSetupWorking(null);
    }
  }

  async function copySpeechInstallCommand() {
    const command = speechSetup?.installCommand ?? "Install the Loom local speech engine from Settings.";
    try {
      await navigator.clipboard.writeText(command);
      setMessage("Install command copied.");
    } catch {
      setMessage(command);
    }
  }

  async function installLocalSpeechEngine() {
    setSpeechSetupWorking("install-runtime");
    try {
      const status = await engineClient.getSpeechSetupStatus();
      setSpeechSetup(status);
      if (status.detectedBinaryPath) {
        setMessage("Local Speech Engine is already installed.");
      } else if (status.runningInElectron) {
        setMessage(
          "This Loom build does not include a bundled Local Speech Engine yet. Add the packaged runtime asset and rebuild, or use the advanced developer fallback."
        );
      } else {
        setMessage(
          "Local Speech Engine installation is available in the packaged Electron app. Developer fallback remains available below."
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check Local Speech Engine setup.");
    } finally {
      setSpeechSetupWorking(null);
    }
  }

  async function downloadSpeechModel() {
    setSpeechSetupWorking("download-model");
    setMessage("Downloading Whisper model...");
    try {
      const status = await engineClient.downloadSpeechSetupModel();
      setSpeechSetup(status);
      setMessage(status.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not download Whisper model.");
    } finally {
      setSpeechSetupWorking(null);
    }
  }

  async function configureSpeechProviderFromSetup() {
    setSpeechSetupWorking("configure");
    try {
      const status = await engineClient.configureSpeechSetup();
      setSpeechSetup(status);
      const config = await engineClient.getServiceConfig();
      setSpeechDraft(config.speech);
      const health = await engineClient.getSpeechProviderHealth();
      setServiceStatus((current) => ({
        ...current,
        serviceConfig: config,
        speechHealth: health,
        speechHealthError: undefined,
      }));
      setMessage(status.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not configure Speech-to-Text.");
    } finally {
      setSpeechSetupWorking(null);
    }
  }

  async function resetSpeechProviderConfig() {
    setSpeechSetupWorking("reset");
    try {
      const result = await engineClient.updateServiceConfig({
        speech: {
          enabled: true,
          defaultProviderKind: "local_command",
          localCommandPath: null,
          localCommandArgs: [],
          localCommandTimeoutMs: defaultSpeechConfigDraft.localCommandTimeoutMs,
          localTempDir: null,
          localCommandOutputMode: defaultSpeechConfigDraft.localCommandOutputMode,
          localCommandTranscriptFileExtension:
            defaultSpeechConfigDraft.localCommandTranscriptFileExtension,
        },
      });
      const [setup, health] = await Promise.all([
        engineClient.getSpeechSetupStatus(),
        engineClient.getSpeechProviderHealth(),
      ]);
      setSpeechSetup(setup);
      setSpeechDraft(result.config.speech);
      setServiceStatus((current) => ({
        ...current,
        serviceConfig: result.config,
        speechHealth: health,
        speechHealthError: undefined,
      }));
      setMessage("Speech-to-Text configuration reset. Downloaded models were not deleted.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not reset Speech-to-Text configuration."
      );
    } finally {
      setSpeechSetupWorking(null);
    }
  }

  async function runSpeechSmokeTest() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      logElectronEvent("warn", "speech.settings_smoke.unsupported_recorder");
      setSpeechSmoke({
        status: "error",
        message: "This browser cannot record a Speech-to-Text smoke sample.",
      });
      return;
    }
    logElectronEvent("info", "speech.settings_smoke.started");
    setSpeechSmoke({ status: "recording", message: "Recording a short sample..." });
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      logElectronEvent("info", "speech.settings_smoke.recording_started", {
        mimeType: recorder.mimeType || "unknown",
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      await new Promise<void>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("Speech sample recording failed."));
        recorder.onstop = () => resolve();
        recorder.start();
        window.setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, 2500);
      });
      setSpeechSmoke({ status: "transcribing", message: "Transcribing sample..." });
      const wavAudio = await transcodeRecordedAudioToPcmWav(
        chunks,
        recorder.mimeType || "audio/webm"
      );
      logElectronEvent("info", "speech.settings_smoke.transcribe_requested", {
        sourceMimeType: wavAudio.sourceMimeType,
        mimeType: wavAudio.mimeType,
        sourceByteSize: wavAudio.sourceByteSize,
        byteSize: wavAudio.wavByteSize,
        chunkCount: chunks.length,
        sampleRate: wavAudio.sampleRate,
        channelCount: wavAudio.channelCount,
        sourceSampleRate: wavAudio.sourceSampleRate,
        sourceChannelCount: wavAudio.sourceChannelCount,
        durationSeconds: Number(wavAudio.durationSeconds.toFixed(3)),
      });
      const response = await engineClient.transcribeSpeech({
        audioBytes: wavAudio.audioBytes,
        mimeType: wavAudio.mimeType,
        mode: "preview",
        metadata: {
          source: "settings_speech_smoke_test",
          sourceMimeType: wavAudio.sourceMimeType,
          audioFormat: "pcm_s16le_wav",
          sampleRate: wavAudio.sampleRate,
          channelCount: wavAudio.channelCount,
          sourceSampleRate: wavAudio.sourceSampleRate,
          sourceChannelCount: wavAudio.sourceChannelCount,
          durationSeconds: wavAudio.durationSeconds,
          sourceByteSize: wavAudio.sourceByteSize,
          wavByteSize: wavAudio.wavByteSize,
        },
      });
      logElectronEvent("info", "speech.settings_smoke.transcribe_succeeded", {
        transcriptLength: response.transcript.length,
        audioPersisted: response.retention.audioPersisted,
        transcriptPersisted: response.retention.transcriptPersisted,
      });
      setSpeechSmoke({
        status: "success",
        message: "Speech-to-Text smoke test passed.",
        transcript: response.transcript,
      });
    } catch (error) {
      const message = await speechTranscriptionErrorMessage(error, engineClient);
      const details =
        error instanceof Error ? ((error as Error & { kind?: unknown; details?: unknown }).details ?? {}) : {};
      const safeDetails =
        typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
      logElectronEvent("warn", "speech.settings_smoke.failed", {
        message,
        kind: error instanceof Error ? (error as Error & { kind?: unknown }).kind : undefined,
        serviceErrorCode:
          typeof safeDetails.serviceErrorCode === "string" ? safeDetails.serviceErrorCode : undefined,
        serviceKind: typeof safeDetails.serviceKind === "string" ? safeDetails.serviceKind : undefined,
        status: typeof safeDetails.status === "number" ? safeDetails.status : undefined,
        path: typeof safeDetails.path === "string" ? safeDetails.path : undefined,
        diagnostics: safeDetails.diagnostics,
      });
      setSpeechSmoke({
        status: "error",
        message,
      });
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  const activeCategoryLabel =
    settingsCategories.find((category) => category.id === activeCategory)?.label ?? "Settings";
  const quickModel = getProfileModel(draft, "quick");
  const mainModel = getProfileModel(draft, "main");
  const currentMainProviderProfileId =
    serviceStatus.serviceConfig?.providers?.mainProviderProfileId ??
    OLLAMA_LOCAL_PROVIDER_PROFILE_ID;
  const currentMainModelId =
    serviceStatus.serviceConfig?.providers?.mainModelId ??
    serviceStatus.serviceConfig?.providers?.defaultMainModel ??
    draft.profiles.mainModelId;
  const selectedMainModelReady =
    currentMainProviderProfileId === "ollama-local" ? mainModel.installed : true;
  const selectedModelsReady = quickModel.installed && selectedMainModelReady;
  const demoResponsesAvailable = canUseMockResponseMode();
  const demoResponsesForced = import.meta.env.VITE_ENABLE_MOCK_RESPONSES === "true";
  const demoResponsesEnabled = isMockResponseModeEnabled(draft);
  const quickModelOptions = demoResponsesEnabled ? [quickModel] : draft.ollama.models;
  const activeRemoteDiscoveredModels = useMemo(() => {
    if (currentMainProviderProfileId === OLLAMA_LOCAL_PROVIDER_PROFILE_ID) return [];
    return getDiscoveredModelsForProfile(
      currentMainProviderProfileId,
      serviceStatus.capability?.models
    );
  }, [currentMainProviderProfileId, serviceStatus.capability?.models]);

  const mainModelOptions = useMemo(() => {
    if (demoResponsesEnabled) return [mainModel];
    if (currentMainProviderProfileId === OLLAMA_LOCAL_PROVIDER_PROFILE_ID) {
      return draft.ollama.models;
    }

    const providerName = draft.profiles.mainProviderDisplayName ?? "Remote";
    const remoteOptions = [
      {
        id: mainModel.id,
        name: mainModel.name.includes("·") ? mainModel.name : `${providerName} · ${mainModel.name}`,
        provider: currentMainProviderProfileId,
        installed: true,
      },
      ...activeRemoteDiscoveredModels
        .filter((modelName) => modelName !== mainModel.id)
        .map((modelName) => ({
          id: modelName,
          name: `${providerName} · ${modelName}`,
          provider: currentMainProviderProfileId,
          installed: true,
        })),
    ];

    const ollamaOptions = draft.ollama.models.map((model) => ({
      id: model.id,
      name: `Ollama · ${model.name}`,
      provider: OLLAMA_LOCAL_PROVIDER_PROFILE_ID,
      installed: model.installed,
    }));

    return [...remoteOptions, ...ollamaOptions];
  }, [
    demoResponsesEnabled,
    currentMainProviderProfileId,
    mainModel,
    activeRemoteDiscoveredModels,
    draft.ollama.models,
    draft.profiles.mainProviderDisplayName,
  ]);

  function renderSegment<TValue extends string>({
    label,
    name,
    value,
    options,
    onChange,
  }: {
    label: string;
    name: string;
    value: TValue;
    options: Array<{ value: TValue; label: string }>;
    onChange: (value: TValue) => void;
  }) {
    return (
      <fieldset className="settings-segment" aria-label={label}>
        <legend>{label}</legend>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  function renderUiPreferencesSettings() {
    return (
      <>
        {renderAppearanceSettings()}

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>References</span>
              <h3>Reference display</h3>
            </div>
          </div>
          {renderSegment({
            label: "Reference Display Mode",
            name: "reference-display-mode",
            value: appSettings.referenceDisplayMode,
            options: [
              { value: "title", label: "Title" },
              { value: "code", label: "Code" },
            ],
            onChange: (referenceDisplayMode) =>
              updateAppSettings({ ...appSettings, referenceDisplayMode }),
          })}
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Weft</span>
              <h3>Weft behavior</h3>
            </div>
          </div>
          {renderSegment({
            label: "Open Weft as",
            name: "weft-open-behavior",
            value: appSettings.weftOpenBehavior,
            options: [
              { value: "adaptive", label: "Adaptive" },
              { value: "split-when-possible", label: "Split when possible" },
              { value: "always-full", label: "Always full Loom" },
            ],
            onChange: (weftOpenBehavior) =>
              updateAppSettings({ ...appSettings, weftOpenBehavior }),
          })}
          <small>Adaptive preserves the current responsive split/full behavior.</small>
        </section>

        <section className="provider-section settings-two-column settings-field-grid">
          <label className="settings-field">
            <span>Font Size</span>
            <select
              value={appSettings.fontSize}
              onChange={(event) =>
                updateAppSettings({
                  ...appSettings,
                  fontSize: event.target.value as AppSettings["fontSize"],
                })
              }
            >
              <option value="very-small">Very Small</option>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
              <option value="very-large">Very Large</option>
            </select>
            <small>Controls Settings and Loom text scale.</small>
          </label>
          <label className="settings-field">
            <span>Language</span>
            <select
              value={appSettings.language}
              onChange={(event) =>
                updateAppSettings({
                  ...appSettings,
                  language: event.target.value as AppSettings["language"],
                })
              }
            >
              <option value="system">System language</option>
              <option value="en">English</option>
              <option value="tr">Turkish</option>
              <option value="el">Greek</option>
            </select>
            <small>Language structure only. Full i18n is not enabled yet.</small>
          </label>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Loom surface</span>
              <h3>Long message controls</h3>
            </div>
          </div>
          {[
            ["userMessages", "Collapse long messages"],
            ["responses", "Collapse long responses"],
          ].map(([key, label]) => (
            <label className="settings-toggle" key={key}>
              <input
                type="checkbox"
                checked={Boolean(
                  appSettings.messageCollapse[key as keyof MessageCollapseSettings]
                )}
                onChange={(event) =>
                  updateMessageCollapseSettings({
                    ...appSettings.messageCollapse,
                    [key]: event.target.checked,
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
          <small>
            These only affect the Loom surface. Stored content, copy, references, and detail
            views still use the full text.
          </small>
        </section>

        {renderNotificationsSettings()}
        {renderAccessibilitySettings()}
        {renderStartupSettings()}
      </>
    );
  }

  function renderAIProvidersSettings() {
    const providerProfiles = serviceStatus.serviceConfig?.providers?.profiles ?? [];
    const providerOffline = runtimeHealth.status === "not_running";
    const providerInvalid = runtimeHealth.status === "degraded";
    const providerConnected = runtimeHealth.status === "ready" && runtimeHealth.ollama_running;
    const noInstalledModels = providerConnected && !runtimeHealth.models_available;
    const selectedModelMissing =
      providerConnected && runtimeHealth.models_available && !selectedModelsReady;
    const providerCardTitle = demoResponsesEnabled
      ? "Demo responses enabled"
      : providerOffline
        ? "Local model provider is offline"
        : providerInvalid
          ? "Provider configuration needs attention"
          : noInstalledModels
            ? "No models installed yet"
            : selectedModelMissing
              ? "Selected model is not installed"
              : providerConnected
                ? "Local model provider connected"
                : "Connection not tested yet";
    const providerCardMessage = demoResponsesEnabled
      ? "Demo responses bypass the local model provider."
      : providerOffline
        ? "Loom is running normally. Start or install Ollama to use local models."
        : noInstalledModels
          ? "Ollama is running, but it has no installed models yet."
          : selectedModelMissing
            ? "Install the selected Quick/Main model before sending prompts."
            : runtimeHealth.message;
    const providerSecurity = runtimeHealth.ollama?.security;
    const providerSecurityText = securityAccessLabel(providerSecurity, draft.ollama.baseUrl);
    const providerVersionText = providerVersionLabel(providerSecurity?.versionStatus);
    return (
      <>
        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Ollama</span>
              <h3>Local model provider</h3>
            </div>
            <span className={`connection-pill ${draft.ollama.lastConnectionStatus}`}>
              {providerPillLabel(draft.ollama.lastConnectionStatus)}
            </span>
          </div>

          <label className="settings-field">
            <span>Base URL</span>
            <input
              value={draft.ollama.baseUrl}
              onChange={(event) =>
                update({
                  ...draft,
                  ollama: { ...draft.ollama, baseUrl: event.target.value },
                })
              }
            />
          </label>

          <div className="settings-actions">
            <button onClick={testConnection} disabled={working === "test" || runtimeHealth.checking}>
              <CheckCircle2 size={14} />
              Retry connection
            </button>
            <button onClick={refreshModels} disabled={working === "refresh"}>
              <RefreshCw size={14} />
              Refresh Models
            </button>
            <button onClick={resetDefaults}>
              <RotateCcw size={14} />
              Reset to defaults
            </button>
          </div>

          <div
            className={`runtime-health-card ${
              noInstalledModels || selectedModelMissing ? "warning" : runtimeHealth.status
            }`}
          >
            <strong>{providerCardTitle}</strong>
            <span>{providerCardMessage}</span>
            {runtimeHealth.checkedAt && (
              <small>Last checked {new Date(runtimeHealth.checkedAt).toLocaleTimeString()}</small>
            )}
            {runtimeHealth.ollama?.version && (
              <span>Ollama version: {runtimeHealth.ollama.version}</span>
            )}
            {runtimeHealth.ollama?.security && (
              <>
                <span>{providerSecurityText}</span>
                <span>{providerVersionText}</span>
                {runtimeHealth.ollama.security.warnings.slice(0, 2).map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
              </>
            )}
            {!demoResponsesEnabled && !runtimeHealth.ollama_installed && (
              <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
                Install Ollama
              </a>
            )}
          </div>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={draft.ollama.exposeToNetwork}
              onChange={(event) =>
                update({
                  ...draft,
                  ollama: {
                    ...draft.ollama,
                    exposeToNetwork: event.target.checked,
                  },
                })
              }
            />
            <span>Expose Ollama to network</span>
          </label>

          {message && <p className="settings-status">{message}</p>}
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Profiles</span>
              <h3>Provider connections</h3>
            </div>
            <button
              className="settings-inline-button"
              onClick={() => void refreshServiceStatus()}
              disabled={serviceStatus.loading}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
          <div className="settings-placeholder">
            <strong>Local-first provider policy</strong>
            <span>
              Local providers keep prompts on this machine. Remote providers send prompts,
              references, and selected context to the configured provider. API keys are stored
              through the loom-service secret store and are never shown again.
            </span>
          </div>
          {serviceStatus.configError && (
            <p className="settings-status">{serviceStatus.configError}</p>
          )}
          {providerProfiles.length === 0 ? (
            <div className="settings-placeholder settings-placeholder-disabled">
              <strong>No provider profiles reported</strong>
              <span>Refresh service status after loom-service is ready.</span>
            </div>
          ) : (
            <div className="provider-profile-list">
              {providerProfiles.map((profile) => {
                const secretStatus = providerSecretStatuses[profile.id];
                const runtimeProviderStatus = runtimeProviderStatuses[profile.id];
                const secretLabel = providerSecretStatusLabel(profile, secretStatus);
                const remote = isRemoteProviderProfile(profile);
                const gate = canEnableProviderProfile(
                  profile,
                  secretStatus,
                  providerPrivacyAcknowledged[profile.id] ?? false
                );
                const mainSelectionGate = canSelectProviderProfileForMain(
                  profile,
                  secretStatus,
                  runtimeProviderStatus,
                  providerPrivacyAcknowledged[profile.id] ?? false
                );
                const selectedForMain = currentMainProviderProfileId === profile.id;
                const enableWorking = providerProfileWorking === `${profile.id}:enabled`;
                const mainWorking = providerProfileWorking === `${profile.id}:main`;
                const secretWorking =
                  providerProfileWorking === `${profile.id}:secret-save` ||
                  providerProfileWorking === `${profile.id}:secret-remove` ||
                  providerProfileWorking === `${profile.id}:secret-test`;
                return (
                  <article
                    className={`provider-profile-card ${profile.enabled ? "enabled" : "disabled"}`}
                    key={profile.id}
                  >
                    <div className="provider-profile-card-header">
                      <span className="provider-profile-icon">
                        {profile.requiresSecret ? <KeyRound size={15} /> : <Server size={15} />}
                      </span>
                      <div>
                        <h4>{profile.displayName}</h4>
                        <small>{profile.id}</small>
                      </div>
                      <span className={`connection-pill ${profile.enabled ? "connected" : ""}`}>
                        {selectedForMain ? "Main" : profile.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>

                    <div className="provider-profile-badges">
                      {providerProfileBadges(profile).map((badge) => (
                        <span key={badge}>{badge}</span>
                      ))}
                    </div>

                    <dl className="provider-profile-meta">
                      <div>
                        <dt>Kind</dt>
                        <dd>{profile.providerKind}</dd>
                      </div>
                      <div>
                        <dt>Vendor</dt>
                        <dd>{profile.vendor}</dd>
                      </div>
                      <div>
                        <dt>Transport</dt>
                        <dd>{profile.transportKind}</dd>
                      </div>
                      <div>
                        <dt>Endpoint</dt>
                        <dd>{profile.baseUrl ?? "Not configured"}</dd>
                      </div>
                      <div>
                        <dt>Default model</dt>
                        <dd>{profile.defaultModel ?? "Not configured"}</dd>
                      </div>
                      <div>
                        <dt>Main selection</dt>
                        <dd>{selectedForMain ? `Selected (${currentMainModelId})` : "Not selected"}</dd>
                      </div>
                      <div>
                        <dt>Secret</dt>
                        <dd>{secretLabel}</dd>
                      </div>
                      <div>
                        <dt>Runtime</dt>
                        <dd>{runtimeProviderStatus?.runtimeStatus ?? runtimeProviderStatus?.status ?? "Unknown"}</dd>
                      </div>
                    </dl>

                    {runtimeProviderStatus?.warnings && runtimeProviderStatus.warnings.length > 0 && (
                      <small className="provider-profile-warning">
                        {runtimeProviderStatus.warnings[0]}
                      </small>
                    )}

                    {profile.requiresSecret && (
                      <div className="provider-secret-controls">
                        <label className="settings-field">
                          <span>API key</span>
                          <input
                            type="password"
                            autoComplete="new-password"
                            spellCheck={false}
                            placeholder={
                              secretStatus?.present ? "Paste replacement key" : "Paste API key"
                            }
                            value={providerSecretDrafts[profile.id] ?? ""}
                            onChange={(event) =>
                              updateProviderSecretDraft(profile.id, event.target.value)
                            }
                          />
                          <small>
                            Write-only. Saved keys are not displayed after submission.
                          </small>
                        </label>
                        <div className="settings-actions">
                          <button
                            onClick={() => void saveProviderSecret(profile)}
                            disabled={secretWorking}
                          >
                            {secretStatus?.present ? "Replace key" : "Set key"}
                          </button>
                          <button
                            onClick={() => void testProviderSecret(profile)}
                            disabled={secretWorking}
                          >
                            Test key
                          </button>
                          <button
                            onClick={() => void removeProviderSecret(profile)}
                            disabled={secretWorking || !secretStatus?.present}
                          >
                            Remove key
                          </button>
                        </div>
                      </div>
                    )}

                    {remote && (
                      <label className="settings-toggle provider-privacy-ack">
                        <input
                          type="checkbox"
                          checked={providerPrivacyAcknowledged[profile.id] ?? false}
                          onChange={(event) =>
                            setProviderPrivacyAcknowledged((current) => ({
                              ...current,
                              [profile.id]: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          I understand prompts and selected context may leave this device when
                          using {profile.displayName}.
                        </span>
                      </label>
                    )}

                    {remote && (
                      <div className="provider-discovery-section">
                        <h5>Model Discovery</h5>
                        <div className="discovery-controls">
                          <button
                            type="button"
                            onClick={() => void discoverModelsForProfile(profile)}
                            disabled={
                              !profile.enabled ||
                              (profile.requiresSecret && !secretStatus?.present) ||
                              localDiscoveryState[profile.id]?.status === "discovering"
                            }
                          >
                            <RefreshCw
                              size={12}
                              className={
                                localDiscoveryState[profile.id]?.status === "discovering"
                                  ? "spin"
                                  : ""
                              }
                            />
                            {getDiscoveredModelsForProfile(
                              profile.id,
                              serviceStatus.capability?.models
                            ).length > 0 || (localDiscoveryState[profile.id]?.models?.length ?? 0) > 0
                              ? "Refresh models"
                              : "Discover models"}
                          </button>
                          {(() => {
                            const status =
                              localDiscoveryState[profile.id]?.status ||
                              (!profile.enabled
                                ? "disabled"
                                : profile.requiresSecret && !secretStatus?.present
                                  ? "missing_secret"
                                  : "idle");
                            const msg = localDiscoveryState[profile.id]?.message;
                            switch (status) {
                              case "discovering":
                                return (
                                  <span className="discovery-status-label discovering">
                                    Discovering...
                                  </span>
                                );
                              case "success":
                                return (
                                  <span className="discovery-status-label success">
                                    Success
                                  </span>
                                );
                              case "disabled":
                                return (
                                  <span className="discovery-status-label disabled">
                                    Disabled
                                  </span>
                                );
                              case "missing_secret":
                                return (
                                  <span className="discovery-status-label missing_secret">
                                    Key required
                                  </span>
                                );
                              case "unauthorized":
                                return (
                                  <span className="discovery-status-label unauthorized">
                                    Unauthorized (401)
                                  </span>
                                );
                              case "rate_limited":
                                return (
                                  <span className="discovery-status-label rate_limited">
                                    Rate limited (429)
                                  </span>
                                );
                              case "unavailable":
                                return (
                                  <span className="discovery-status-label unavailable">
                                    Unavailable
                                  </span>
                                );
                              case "invalid_response":
                                return (
                                  <span className="discovery-status-label invalid_response">
                                    Invalid response
                                  </span>
                                );
                              case "invalid_config":
                                return (
                                  <span className="discovery-status-label invalid_config">
                                    Invalid config
                                  </span>
                                );
                              case "feature_gated":
                                return (
                                  <span className="discovery-status-label feature_gated">
                                    Feature gated
                                  </span>
                                );
                              case "provider_error":
                                return (
                                  <span
                                    className="discovery-status-label provider_error"
                                    title={msg}
                                  >
                                    Provider error
                                  </span>
                                );
                              case "error":
                                return (
                                  <span className="discovery-status-label error" title={msg}>
                                    Request failed
                                  </span>
                                );
                              default:
                                return (
                                  <span className="discovery-status-label idle">Idle</span>
                                );
                            }
                          })()}
                        </div>
                        {localDiscoveryState[profile.id]?.message && (
                          <p className="discovery-error-message">
                            {localDiscoveryState[profile.id]?.message}
                          </p>
                        )}
                        {(() => {
                          const capModels = getDiscoveredModelsForProfile(
                            profile.id,
                            serviceStatus.capability?.models
                          );
                          const locModels = localDiscoveryState[profile.id]?.models ?? [];
                          const modelsList = Array.from(new Set([...capModels, ...locModels]));
                          if (modelsList.length === 0) return null;
                          return (
                            <div className="discovered-models-list">
                              <h6>Available Models</h6>
                              <ul>
                                {modelsList.map((modelName) => {
                                  const isSelected =
                                    selectedForMain && currentMainModelId === modelName;
                                  return (
                                    <li key={modelName} className={isSelected ? "selected" : ""}>
                                      <span>
                                        {profile.displayName} · {modelName}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void selectDiscoveredModel(profile, modelName)
                                        }
                                        disabled={isSelected}
                                      >
                                        {isSelected ? "Selected" : "Select"}
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    <div className="provider-profile-actions">
                      <span>{providerProfileAccessLabel(profile)} provider</span>
                      <button
                        onClick={() => void selectProviderProfileForMain(profile)}
                        disabled={
                          mainWorking ||
                          selectedForMain ||
                          demoResponsesEnabled ||
                          !mainSelectionGate.allowed
                        }
                        title={
                          !mainSelectionGate.allowed ? mainSelectionGate.reason : undefined
                        }
                      >
                        {selectedForMain ? "Selected for Main" : "Use for Main"}
                      </button>
                      {remote ? (
                        <button
                          onClick={() => void setProviderProfileEnabled(profile, !profile.enabled)}
                          disabled={enableWorking || (!profile.enabled && !gate.allowed)}
                          title={!profile.enabled && gate.reason ? gate.reason : undefined}
                        >
                          {profile.enabled ? "Disable" : "Enable"}
                        </button>
                      ) : (
                        <em>Always enabled</em>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {demoResponsesAvailable && (
          <section className="provider-section">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={demoResponsesEnabled}
                disabled={demoResponsesForced}
                onChange={(event) =>
                  update({
                    ...draft,
                    demo: {
                      ...draft.demo,
                      mockResponsesEnabled: event.target.checked,
                    },
                  })
                }
              />
              <span>Demo Responses</span>
            </label>
            <small>Use mock model responses for UI testing.</small>
          </section>
        )}
      </>
    );
  }

  function renderModelsSettings() {
    return (
      <>
        <section className="provider-section model-profile-grid">
          <label className="settings-field">
            <span>Quick Model</span>
            <select
              value={quickModel.id}
              onChange={(event) => setProfile("quick", event.target.value)}
              disabled={demoResponsesEnabled}
            >
              {quickModelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <small>{quickModel.installed ? "Installed" : "Not installed"}</small>
          </label>
          <label className="settings-field">
            <span>Main Model</span>
            <select
              value={mainModel.id}
              onChange={(event) => setProfile("main", event.target.value)}
              disabled={demoResponsesEnabled}
            >
              {mainModelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <small>{mainModel.installed ? "Installed" : "Not installed"}</small>
          </label>
        </section>

        <section className="provider-section provider-runtime-section">
          <label className="settings-field">
            <span>Max Context Length</span>
            <input
              type="range"
              min={2048}
              max={32768}
              step={1024}
              value={draft.ollama.contextLength}
              onChange={(event) =>
                update({
                  ...draft,
                  ollama: {
                    ...draft.ollama,
                    contextLength: Number(event.target.value),
                  },
                })
              }
            />
            <small>
              Loom chooses request context dynamically up to{" "}
              {draft.ollama.contextLength.toLocaleString()} tokens.
            </small>
          </label>
          {draft.ollama.modelLocation && (
            <div className="model-location">
              <span>Model location</span>
              <strong>{draft.ollama.modelLocation}</strong>
            </div>
          )}
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Catalog</span>
              <h3>Model availability metadata</h3>
            </div>
            <span className="settings-planned-pill">Read-only</span>
          </div>
          <div className="settings-placeholder">
            <strong>Provider discovery is a hint</strong>
            <span>
              Provider-discovered models can confirm availability, but local benchmarks and stronger
              catalog signals remain authoritative for capability decisions.
            </span>
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Ollama</span>
              <h3>Installed and suggested models</h3>
            </div>
            <label className="model-search">
              <Search size={13} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models"
              />
            </label>
          </div>
          <div className="provider-model-list">
            {filteredModels.map((model) => {
              const modelJob = Object.values(downloadJobs).find(
                (job) =>
                  job.modelName === model.id &&
                  ["queued", "downloading", "verifying"].includes(job.status)
              );
              const selectedProfiles = [
                draft.profiles.quickModelId === model.id ? "Quick" : "",
                draft.profiles.mainModelId === model.id ? "Main" : "",
              ].filter(Boolean);
              const selectedButUnavailable =
                selectedProfiles.length > 0 && runtimeHealth.status !== "ready";
              return (
                <div className="provider-model-row" key={model.id}>
                  <span>
                    <strong>{model.name}</strong>
                    <small>{model.id}</small>
                    {model.location && <small>{model.location}</small>}
                    <small>{model.provider}</small>
                    {selectedProfiles.length > 0 && (
                      <small>Selected for {selectedProfiles.join(" / ")}</small>
                    )}
                  </span>
                  <em
                    className={
                      selectedButUnavailable
                        ? "missing"
                        : modelJob
                          ? "installing"
                        : model.installed
                          ? "installed"
                          : "missing"
                    }
                  >
                    {selectedButUnavailable
                      ? "Runtime unavailable"
                      : modelJob
                        ? `${Math.round(modelJob.progressPercent)}%`
                      : model.installed
                        ? "Available"
                        : "Missing"}
                  </em>
                  {modelJob ? (
                    <button
                      className="download-model-button"
                      onClick={() => void cancelModelDownload(modelJob.jobId)}
                      aria-label={`Cancel ${model.name} download`}
                      title="Cancel download"
                    >
                      <X size={14} />
                    </button>
                  ) : !model.installed ? (
                    <button
                      className="download-model-button"
                      onClick={() => pullModel(model)}
                      disabled={working === model.id}
                      aria-label={`Download ${model.name}`}
                      title="Download"
                    >
                      <Download size={14} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </>
    );
  }

  function renderAppearanceSettings() {
    return (
      <section className="provider-section">
        <div className="provider-section-heading">
          <div>
            <span>Theme</span>
            <h3>Appearance</h3>
          </div>
        </div>
        {renderSegment({
          label: "Theme",
          name: "theme",
          value: appSettings.theme,
          options: [
            { value: "dark", label: "Dark" },
            { value: "light", label: "Light" },
            { value: "solarized-light", label: "Solarized Light" },
            { value: "system", label: "System" },
          ],
          onChange: (theme) => updateAppSettings({ ...appSettings, theme }),
        })}
        <div className="settings-placeholder">
          <strong>Theme presets</strong>
          <span>Theme preferences are stored locally with the current Loom profile.</span>
        </div>
      </section>
    );
  }

  function renderNotificationsSettings() {
    return (
      <section className="provider-section">
        <div className="provider-section-heading">
          <div>
            <span>Notifications</span>
            <h3>Loom feedback</h3>
          </div>
        </div>
        {[
          ["responseComplete", "Notify when response completes"],
          ["longRunningTaskComplete", "Notify when long-running model task finishes"],
          ["modelDownloadComplete", "Notify when model download completes"],
          ["runtimeUnavailable", "Notify when runtime becomes unavailable"],
        ].map(([key, label]) => (
          <label className="settings-toggle" key={key}>
            <input
              type="checkbox"
              checked={Boolean(appSettings.notifications[key as keyof NotificationSettings])}
              onChange={(event) =>
                updateNotificationSettings({
                  ...appSettings.notifications,
                  [key]: event.target.checked,
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </section>
    );
  }

  function renderStartupSettings() {
    return (
      <section className="provider-section">
        <div className="provider-section-heading">
          <div>
            <span>Startup</span>
            <h3>Launch behavior</h3>
          </div>
        </div>
        {[
          ["launchAtLogin", "Launch Loom at login"],
          ["continueFromLastLoom", "Continue from where you left off"],
          ["runtimeCheckOnLaunch", "Start local runtime check on launch"],
          ["showNewLoomIfNoSession", "Show New Loom when no previous Loom is restored"],
        ].map(([key, label]) => (
          <label className="settings-toggle" key={key}>
            <input
              type="checkbox"
              checked={Boolean(appSettings.startup[key as keyof StartupSettings])}
              onChange={(event) =>
                updateStartupSettings({
                  ...appSettings.startup,
                  [key]: event.target.checked,
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
        <small>By default Loom opens the New Loom screen. Enable continuation to restore the last active Loom on launch.</small>
      </section>
    );
  }

  function renderAccessibilitySettings() {
    return (
      <section className="provider-section">
        <div className="provider-section-heading">
          <div>
            <span>Accessibility</span>
            <h3>Comfort controls</h3>
          </div>
        </div>
        {[
          ["reduceMotion", "Reduce motion"],
          ["increaseContrast", "Increase contrast"],
          ["largerClickTargets", "Larger click targets"],
          ["alwaysShowIconLabels", "Always show labels on icon buttons"],
          ["keyboardNavigationHints", "Keyboard navigation hints"],
        ].map(([key, label]) => (
          <label className="settings-toggle" key={key}>
            <input
              type="checkbox"
              checked={Boolean(appSettings.accessibility[key as keyof AccessibilitySettings])}
              onChange={(event) =>
                updateAccessibilitySettings({
                  ...appSettings.accessibility,
                  [key]: event.target.checked,
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </section>
    );
  }

  function shortcutMatchesQuery(shortcut: KeyboardShortcutDefinition, value: string) {
    const queryValue = value.trim().toLowerCase();
    if (!queryValue) return true;
    return [
      shortcut.title,
      shortcut.description,
      shortcut.category,
      shortcut.mac.join(" "),
      shortcut.windows.join(" "),
    ]
      .join(" ")
      .toLowerCase()
      .includes(queryValue);
  }

  function renderShortcutKeys(keys: string[], platform: ShortcutPlatform) {
    const labels = keys.map((key) => displayKeyLabel(key, platform));
    return (
      <span className="shortcut-key-sequence" aria-label={labels.join(" ")}>
        {keys.map((key) => (
          <kbd key={key}>{displayKeyLabel(key, platform)}</kbd>
        ))}
      </span>
    );
  }

  function renderShortcutSettings() {
    const shortcuts = keyboardShortcutDefinitions.filter((shortcut) =>
      shortcutMatchesQuery(shortcut, shortcutQuery)
    );
    return (
      <section className="provider-section shortcuts-section">
        <div className="provider-section-heading">
          <div>
            <span>Keyboard</span>
            <h3>Browser-style shortcuts</h3>
          </div>
        </div>
        <label className="shortcut-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={shortcutQuery}
            onChange={(event) => setShortcutQuery(event.target.value)}
            placeholder="Search for a command or shortcut"
            aria-label="Search keyboard shortcuts"
          />
        </label>
        <div className="settings-placeholder">
          <strong>Default behavior</strong>
          <span>These shortcuts are fixed Loom defaults for now and follow browser conventions where they fit Loom navigation.</span>
          <span>macOS uses Command/Option. Windows and Linux use Ctrl/Alt equivalents.</span>
        </div>
        <div className="shortcut-list">
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.Icon;
            return (
              <div className="shortcut-row" key={shortcut.id}>
                <span className="shortcut-command-icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span className="shortcut-command-copy">
                  <strong>{shortcut.title}</strong>
                  <small>{shortcut.description}</small>
                </span>
                <span className="shortcut-platform">
                  <em>macOS</em>
                  {renderShortcutKeys(shortcutKeysForPlatform(shortcut, "apple"), "apple")}
                </span>
                <span className="shortcut-platform">
                  <em>Windows/Linux</em>
                  {renderShortcutKeys(shortcutKeysForPlatform(shortcut, "windows"), "windows")}
                </span>
              </div>
            );
          })}
          {shortcuts.length === 0 && (
            <div className="settings-placeholder">
              <strong>No matching shortcuts</strong>
              <span>Try a command name such as Address Bar, New Loom, Back, or Reload.</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  function formatBytes(value?: number) {
    if (!value || value <= 0) return "Unknown";
    const gib = value / (1024 ** 3);
    return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`;
  }

  function statusLabel(value?: string) {
    if (!value) return "Unknown";
    return value
      .split(/[-_]/g)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function renderRuntimeSettings() {
    const health = serviceStatus.health;
    const config = serviceStatus.config;
    const desktopMode = desktopRuntimeInfo?.isElectron ? "Electron sidecar" : "Web";
    const desktopStatus = desktopRuntimeStatus?.state ?? (desktopRuntimeInfo?.isElectron ? "unknown" : "unavailable");
    const runtimeNeedsModelAction =
      runtimeHealth.ollama_running &&
      (!runtimeHealth.models_available || !selectedModelsReady);
    const runtimeState = health?.status ?? runtimeHealth.status;
    const serviceMessage = runtimeNeedsModelAction
      ? "Loom is running, but the selected model is not ready."
      : health?.status === "ready"
        ? "Loom is running normally. Model provider availability is shown separately."
        : runtimeHealth.message;
    const desktopCardState = !desktopRuntimeBridge
      ? "info"
      : desktopStatus === "ready"
        ? "ready"
        : "degraded";
    const isMismatched =
      desktopRuntimeInfo?.isElectron &&
      health?.binaryFingerprint &&
      desktopRuntimeStatus?.expectedFingerprint &&
      health.binaryFingerprint !== desktopRuntimeStatus.expectedFingerprint;

    const freshnessInfo = desktopRuntimeInfo?.isElectron && health?.binaryFingerprint
      ? {
          label: isMismatched ? "⚠ runtime_binary_mismatch" : "✓ Fresh",
        }
      : null;

    return (
      <>
        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Runtime</span>
              <h3>Engine and service status</h3>
            </div>
            <button
              type="button"
              className="download-model-button"
              onClick={() => void refreshServiceStatus()}
              disabled={serviceStatus.loading}
              aria-label={serviceStatus.loading ? "Refreshing service status" : "Refresh service status"}
              title={serviceStatus.loading ? "Refreshing service status" : "Refresh service status"}
            >
              <RefreshCw size={13} />
            </button>
          </div>

          <div className={`runtime-health-card ${health?.status ?? runtimeHealth.status}`}>
            <strong>
              Loom Runtime
              {" · "}
              {runtimeStatusLabel(runtimeNeedsModelAction ? "degraded" : runtimeState)}
            </strong>
            <span>
              Product mode uses the Rust-service engine boundary.
            </span>
            <span>{serviceMessage}</span>
            {runtimeNeedsModelAction && (
              <span>Install or choose a Quick/Main model before sending prompts.</span>
            )}
            {health?.serviceUrl && <span>Service URL: {health.serviceUrl}</span>}
            {health?.database && <span>Database: {statusLabel(health.database.status)}</span>}
            {health?.config && <span>Config: {statusLabel(health.config.status)}</span>}
            {freshnessInfo && (
              <span>
                Runtime Freshness:{" "}
                <span
                  style={{
                    color: isMismatched ? "var(--accent)" : "var(--success)",
                    fontWeight: 500,
                  }}
                >
                  {freshnessInfo.label}
                </span>
              </span>
            )}
            {health?.error && <span>Start loom-service and refresh. {health.error}</span>}
          </div>

          <div className="settings-actions">
            <button onClick={testConnection} disabled={working === "test" || runtimeHealth.checking}>
              <CheckCircle2 size={14} />
              Check provider
            </button>
            <button
              type="button"
              onClick={() => void refreshServiceStatus()}
              disabled={serviceStatus.loading}
            >
              <RefreshCw size={14} />
              Refresh service status
            </button>
          </div>
          {message && <p className="settings-status">{message}</p>}
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Desktop runtime</span>
              <h3>Electron sidecar lifecycle</h3>
            </div>
            <button
              type="button"
              className="download-model-button"
              onClick={() => void refreshDesktopRuntimeStatus()}
              disabled={!desktopRuntimeBridge || desktopRuntimeWorking}
              aria-label="Refresh runtime"
              title="Refresh runtime"
            >
              <RefreshCw size={13} />
            </button>
          </div>

          <div className={`runtime-health-card ${desktopCardState}`}>
            <strong>
              Runtime: loom-service · {desktopRuntimeBridge ? statusLabel(desktopStatus) : "Web mode"}
            </strong>
            <span>Mode: {desktopMode}</span>
            {desktopRuntimeStatus?.dataMode && (
              <span>Data mode: {statusLabel(desktopRuntimeStatus.dataMode)}</span>
            )}
            {desktopRuntimeStatus?.serviceUrl && (
              <span>Service URL: {desktopRuntimeStatus.serviceUrl}</span>
            )}
            {desktopRuntimeStatus?.pid && <span>PID: {desktopRuntimeStatus.pid}</span>}
            {desktopRuntimeStatus?.port && <span>Port: {desktopRuntimeStatus.port}</span>}
            {desktopRuntimeStatus?.binaryPath && (
              <span>Binary: {desktopRuntimeStatus.binaryPath}</span>
            )}
            {desktopRuntimeStatus?.dbPath && <span>Database: {desktopRuntimeStatus.dbPath}</span>}
            {desktopRuntimeStatus?.configPath && (
              <span>Config: {desktopRuntimeStatus.configPath}</span>
            )}
            {desktopRuntimeStatus?.appSessionId && (
              <span>App session: {desktopRuntimeStatus.appSessionId}</span>
            )}
            {desktopRuntimeStatus?.logPath && <span>Log: {desktopRuntimeStatus.logPath}</span>}
            {desktopRuntimeStatus?.lastCheckedAt && (
              <span>
                Last checked: {new Date(desktopRuntimeStatus.lastCheckedAt).toLocaleTimeString()}
              </span>
            )}
            {desktopRuntimeStatus?.error && <span>{desktopRuntimeStatus.error}</span>}
            {!desktopRuntimeBridge && (
              <span>Desktop runtime controls are available in the Electron app.</span>
            )}
          </div>

          <div className="settings-actions">
            <button
              type="button"
              onClick={() => void restartDesktopRuntime()}
              disabled={!desktopRuntimeBridge || desktopRuntimeWorking}
            >
              <RotateCcw size={14} />
              {desktopRuntimeWorking ? "Restarting local runtime" : "Restart local runtime"}
            </button>
          </div>
          <small>
            Restarts only the local loom-service sidecar started by Electron. Web mode and
            unrelated dev services are not controlled from here.
          </small>
          {desktopRuntimeMessage && <p className="settings-status">{desktopRuntimeMessage}</p>}
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Configuration</span>
              <h3>Restart and config status</h3>
            </div>
          </div>
          <div className="service-status-grid">
            <div className="settings-placeholder">
              <strong>Config</strong>
              <span>Status: {statusLabel(config?.status)}</span>
              {config?.path && <span>Path: {config.path}</span>}
              <span>Restart required: {config?.restartRequired ? "Yes" : "No"}</span>
              <span>Pending restart: {config?.pendingRestart ? "Yes" : "No"}</span>
            </div>
            <div className="settings-placeholder">
              <strong>Runtime checks</strong>
              <span>Ollama: {runtimeStatusLabel(runtimeHealth.status)}</span>
              <span>
                Last checked:{" "}
                {runtimeHealth.checkedAt
                  ? new Date(runtimeHealth.checkedAt).toLocaleTimeString()
                  : "Connection not tested yet"}
              </span>
            </div>
          </div>
        </section>
      </>
    );
  }

  function renderSpeechToTextSettings() {
    const hasConfig = Boolean(serviceStatus.serviceConfig?.speech);
    const pathConfigured = Boolean(speechDraft.localCommandPath?.trim());
    const providerStatus =
      speechDraft.defaultProviderKind === "disabled"
        ? "Disabled"
        : pathConfigured
          ? "Configured"
          : "Speech-to-Text setup required";
    const unavailable = serviceStatus.configError ?? (!hasConfig ? "Service config is not loaded." : null);
    const canSave = hasConfig && !serviceStatus.configError && working !== "speech-config";
    const speechHealth = serviceStatus.speechHealth;
    const providerOptions: Array<{ value: SpeechToTextProviderKind; label: string }> = [
      { value: "local_command", label: "Local command" },
      { value: "disabled", label: "Disabled" },
    ];
    const setupReady = speechSetup?.state === "ready";
    const modelReady = Boolean(speechSetup?.model.exists);
    const binaryReady = Boolean(speechSetup?.detectedBinaryPath);
    const canConfigureFromSetup = binaryReady && modelReady && speechSetupWorking !== "configure";
    const runtimeSummary = binaryReady
      ? `${speechSetup?.detectedRuntimeSource ?? "local"} runtime`
      : "Not installed";
    const modelSummary = modelReady
      ? `Ready${speechSetup?.model.sizeBytes ? ` · ${formatModelBytes(speechSetup.model.sizeBytes)}` : ""}`
      : "Missing";
    const providerSummary =
      speechSetup?.providerHealth.status ?? speechHealth?.status ?? "Not checked";

    return (
      <section className="provider-section" data-testid="speech-settings-section">
        <div className="provider-section-heading">
          <div>
            <span>Speech-to-Text</span>
            <h3>Local transcription provider</h3>
          </div>
          <span className={`connection-pill ${pathConfigured ? "connected" : "disconnected"}`}>
            {pathConfigured ? "configured" : "not configured"}
          </span>
        </div>

        <div className="speech-setup-hero">
          <strong>{providerStatus}</strong>
          <span>
            Set up local speech once, then use the microphone without terminal commands.
          </span>
          {unavailable && <span>{unavailable}</span>}
          {serviceStatus.speechHealthError && <span>{serviceStatus.speechHealthError}</span>}
          {speechHealth && (
            <span>
              Provider check: {speechHealth.status} · {speechProviderHealthMessage(speechHealth, speechSetup)}
            </span>
          )}
        </div>

        <div className="speech-setup-summary" data-testid="speech-setup-guide">
          <div className={`speech-setup-card ${binaryReady ? "ready" : "needs-action"}`}>
            <strong>Local Speech Engine</strong>
            <span>{runtimeSummary}</span>
          </div>
          <div className={`speech-setup-card ${modelReady ? "ready" : "needs-action"}`}>
            <strong>Speech model</strong>
            <span>{modelSummary}</span>
          </div>
          <div className={`speech-setup-card ${pathConfigured ? "ready" : "needs-action"}`}>
            <strong>Provider</strong>
            <span>{providerSummary}</span>
          </div>
        </div>

        <div className="settings-actions">
          <button
            type="button"
            onClick={() => void refreshSpeechSetupStatus()}
            disabled={Boolean(speechSetupWorking)}
          >
            <RefreshCw size={14} />
            {speechSetupWorking === "check" ? "Checking" : "Check setup"}
          </button>
          {!binaryReady && (
            <button
              type="button"
              onClick={() => void installLocalSpeechEngine()}
              disabled={binaryReady}
            >
              {speechSetupWorking === "install-runtime" ? "Checking engine" : "Install Local Speech Engine"}
            </button>
          )}
          {!modelReady && (
            <button
              type="button"
              onClick={() => void downloadSpeechModel()}
              disabled={!binaryReady || modelReady || speechSetupWorking === "download-model"}
            >
              <Download size={14} />
              {speechSetupWorking === "download-model" ? "Downloading model" : "Download model"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void configureSpeechProviderFromSetup()}
            disabled={!canConfigureFromSetup}
          >
            <CheckCircle2 size={14} />
            Auto-configure provider
          </button>
        </div>

        <div className="speech-test-card">
          <strong>Test Speech-to-Text</strong>
          <span>{speechSmoke.message}</span>
          {speechSmoke.transcript && <span>Transcript: {speechSmoke.transcript}</span>}
          <button
            type="button"
            onClick={() => void runSpeechSmokeTest()}
            disabled={!setupReady || speechSmoke.status === "recording" || speechSmoke.status === "transcribing"}
          >
            {speechSmoke.status === "recording"
              ? "Recording"
              : speechSmoke.status === "transcribing"
                ? "Transcribing"
                : "Test Speech-to-Text"}
          </button>
        </div>

        <div className="settings-placeholder speech-privacy-note">
          <strong>Privacy</strong>
          <span>Local-only transcription. Audio is temporary, transcripts are inserted into the draft, and nothing is auto-sent.</span>
        </div>

        <details className="settings-advanced-panel">
          <summary>Advanced</summary>
          <div className="settings-advanced-content">
            <div className="settings-placeholder">
              <strong>Diagnostics</strong>
              <span>
                Runtime: {speechSetup?.runningInElectron ? "Electron packaged app" : "Web/dev browser"}
              </span>
              <span>
                Local runtime: {speechSetup?.detectedRuntimeSource ?? "not checked"}
                {speechSetup?.detectedBinaryPath ? ` · ${speechSetup.detectedBinaryPath}` : ""}
              </span>
              <span>Runtime version: {speechSetup?.runtimeVersion ?? "Not detected"}</span>
              <span>
                Model path: {speechSetup?.model.path ?? "Unknown"}
              </span>
              <span>Setup status: {speechSetup?.state ?? "not checked"}</span>
              <span>Saved command path: {speechDraft.localCommandPath?.trim() || "Not configured"}</span>
              <small>
                Saved arguments:{" "}
                {speechDraft.localCommandArgs.length
                  ? speechDraft.localCommandArgs.join(" ")
                  : "Not configured"}
              </small>
              {speechSetup?.binaryCandidates.length ? (
                <small>
                  Checked runtimes:{" "}
                  {speechSetup.binaryCandidates
                    .map((candidate) => `${candidate.source}: ${candidate.path}`)
                    .join(", ")}
                </small>
              ) : null}
            </div>

            <div className="settings-actions">
              <button
                type="button"
                onClick={() => void copySpeechInstallCommand()}
                disabled={binaryReady}
              >
                Copy developer fallback
              </button>
              <button
                type="button"
                onClick={() => void resetSpeechProviderConfig()}
                disabled={Boolean(speechSetupWorking)}
              >
                <RotateCcw size={14} />
                {speechSetupWorking === "reset" ? "Resetting" : "Reset Speech-to-Text Configuration"}
              </button>
            </div>

            <div className="settings-two-column settings-field-grid">
              <label className="settings-field">
                <span>Provider kind</span>
                <select
                  value={speechDraft.defaultProviderKind}
                  onChange={(event) =>
                    setSpeechDraft({
                      ...speechDraft,
                      defaultProviderKind: event.target.value as SpeechToTextProviderKind,
                    })
                  }
                >
                  {providerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>Cloud providers and test-only providers are not user-facing options.</small>
              </label>

              <label className="settings-field">
                <span>Command timeout</span>
                <input
                  type="number"
                  min={1_000}
                  step={1_000}
                  value={speechDraft.localCommandTimeoutMs}
                  onChange={(event) =>
                    setSpeechDraft({
                      ...speechDraft,
                      localCommandTimeoutMs: Math.max(1_000, Number(event.target.value) || 1_000),
                    })
                  }
                />
                <small>Milliseconds before the local provider is treated as timed out.</small>
              </label>
            </div>

            <div className="settings-two-column settings-field-grid">
              <label className="settings-field">
                <span>Output mode</span>
                <select
                  value={speechDraft.localCommandOutputMode}
                  onChange={(event) =>
                    setSpeechDraft({
                      ...speechDraft,
                      localCommandOutputMode: event.target.value === "file" ? "file" : "stdout",
                    })
                  }
                >
                  <option value="file">Transcript file</option>
                  <option value="stdout">Standard output</option>
                </select>
                <small>whisper.cpp usually writes transcript files. Other commands may print to stdout.</small>
              </label>

              <label className="settings-field">
                <span>Transcript file extension</span>
                <input
                  value={speechDraft.localCommandTranscriptFileExtension}
                  placeholder="txt"
                  onChange={(event) =>
                    setSpeechDraft({
                      ...speechDraft,
                      localCommandTranscriptFileExtension: event.target.value || "txt",
                    })
                  }
                />
                <small>Used in file output mode. whisper.cpp with -otxt writes {"{output}"}.txt.</small>
              </label>
            </div>

            <label className="settings-field">
              <span>Local command path</span>
              <input
                value={speechDraft.localCommandPath ?? ""}
                placeholder="/usr/local/bin/whisper-cli"
                onChange={(event) =>
                  setSpeechDraft({ ...speechDraft, localCommandPath: event.target.value })
                }
              />
              <small>Path to a local executable. Normal setup should use the Loom-managed engine.</small>
            </label>

            <label className="settings-field">
              <span>Command arguments</span>
              <textarea
                rows={4}
                value={speechArgsText(speechDraft.localCommandArgs)}
                onChange={(event) =>
                  setSpeechDraft({
                    ...speechDraft,
                    localCommandArgs: parseSpeechArgs(event.target.value),
                  })
                }
              />
              <small>
                One argument per line. Supported placeholders: {"{input}"}, {"{audio_file}"}, {"{output}"}, {"{mime_type}"}, {"{language}"}.
              </small>
            </label>

            <label className="settings-field">
              <span>Temporary audio directory</span>
              <input
                value={speechDraft.localTempDir ?? ""}
                placeholder="System temporary directory"
                onChange={(event) =>
                  setSpeechDraft({ ...speechDraft, localTempDir: event.target.value })
                }
              />
              <small>Optional directory for temporary provider input files. Files are cleaned up.</small>
            </label>

            <div className="settings-actions">
              <button type="button" onClick={() => void saveSpeechConfig()} disabled={!canSave}>
                <CheckCircle2 size={14} />
                {working === "speech-config" ? "Saving" : "Save Speech Settings"}
              </button>
              <button
                type="button"
                onClick={() => void refreshServiceStatus()}
                disabled={serviceStatus.loading}
              >
                <RefreshCw size={14} />
                Check Provider
              </button>
            </div>
          </div>
        </details>
      </section>
    );
  }

  function renderOcrRuntimeSettings() {
    const hasConfig = Boolean(serviceStatus.serviceConfig?.ocr);
    const ocrHealth = serviceStatus.ocrHealth;
    const unavailable = serviceStatus.configError ?? (!hasConfig ? "Service config is not loaded." : null);
    const tesseractDetected = Boolean(ocrHealth?.commandPath);
    const rasterizerDetected = Boolean(ocrHealth?.rasterizerCommandPath);
    const ocrReady = ocrHealth?.status === "configured";
    const ocrUnavailable = ocrDraft.enabled && !ocrReady;
    const statusText = !ocrDraft.enabled
      ? "OCR disabled"
      : ocrReady
        ? "OCR ready"
        : "OCR unavailable";
    const canSave = hasConfig && !serviceStatus.configError && working !== "ocr-config";

    return (
      <section className="provider-section" data-testid="ocr-settings-section">
        <div className="provider-section-heading">
          <div>
            <span>OCR</span>
            <h3>Scanned PDF text extraction</h3>
          </div>
          <span className={`connection-pill ${ocrReady ? "connected" : "disconnected"}`}>
            {statusText}
          </span>
        </div>

        <div className={`runtime-health-card ${ocrReady ? "ready" : ocrUnavailable ? "degraded" : "info"}`}>
          <strong>{statusText}</strong>
          <span>
            OCR is optional and local-only. Loom does not install Tesseract, does not use cloud OCR,
            and does not claim image understanding.
          </span>
          {ocrHealth ? <span>{ocrHealth.message}</span> : <span>Run Check OCR Runtime to verify local tools.</span>}
          {unavailable && <span>{unavailable}</span>}
          {serviceStatus.ocrHealthError && <span>{serviceStatus.ocrHealthError}</span>}
        </div>

        <div className="speech-setup-summary">
          <div className={`speech-setup-card ${ocrDraft.enabled ? "ready" : "needs-action"}`}>
            <strong>OCR</strong>
            <span>{ocrDraft.enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <div className={`speech-setup-card ${tesseractDetected ? "ready" : "needs-action"}`}>
            <strong>Tesseract</strong>
            <span>{tesseractDetected ? "Detected" : "Not detected"}</span>
          </div>
          <div className={`speech-setup-card ${rasterizerDetected ? "ready" : "needs-action"}`}>
            <strong>PDF rasterizer</strong>
            <span>{rasterizerDetected ? "Detected" : "Not detected"}</span>
          </div>
        </div>

        <div className="settings-placeholder">
          <strong>Scanned PDF behavior</strong>
          <span>OCR disabled or unavailable: scanned pages stay marked OCR needed.</span>
          <span>OCR ready: only OCR-needed PDF page ranges are rasterized and sent to local Tesseract.</span>
          <span>Selectable text PDFs continue using native text extraction without OCR.</span>
        </div>

        <div className="settings-two-column settings-field-grid">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={ocrDraft.enabled}
              onChange={(event) => setOcrDraft({ ...ocrDraft, enabled: event.target.checked })}
            />
            <span>Enable local OCR</span>
          </label>

          <label className="settings-field">
            <span>Provider</span>
            <select
              value={ocrDraft.provider}
              onChange={(event) => setOcrDraft({ ...ocrDraft, provider: event.target.value })}
            >
              <option value="tesseract">Tesseract</option>
            </select>
            <small>Tesseract is the v1 local OCR provider. Cloud OCR is not available here.</small>
          </label>
        </div>

        <div className="settings-two-column settings-field-grid">
          <label className="settings-field">
            <span>Tesseract path</span>
            <input
              value={ocrDraft.commandPath ?? ""}
              placeholder="/opt/homebrew/bin/tesseract"
              onChange={(event) => setOcrDraft({ ...ocrDraft, commandPath: event.target.value })}
            />
            <small>Leave empty to let loom-service detect Tesseract from common local paths.</small>
          </label>

          <label className="settings-field">
            <span>PDF rasterizer path</span>
            <input
              value={ocrDraft.pdfRasterizerCommandPath ?? ""}
              placeholder="/opt/homebrew/bin/pdftoppm"
              onChange={(event) =>
                setOcrDraft({ ...ocrDraft, pdfRasterizerCommandPath: event.target.value })
              }
            />
            <small>Uses `pdftoppm`/Poppler-style page rasterization before OCR.</small>
          </label>
        </div>

        <div className="settings-two-column settings-field-grid">
          <label className="settings-field">
            <span>Language</span>
            <input
              value={ocrDraft.language}
              placeholder="eng"
              onChange={(event) => setOcrDraft({ ...ocrDraft, language: event.target.value })}
            />
            <small>Use Tesseract language codes such as `eng` or `eng+tur`.</small>
          </label>

          <label className="settings-field">
            <span>DPI</span>
            <input
              type="number"
              min={100}
              max={600}
              step={50}
              value={ocrDraft.dpi}
              onChange={(event) =>
                setOcrDraft({
                  ...ocrDraft,
                  dpi: Math.min(600, Math.max(100, Number(event.target.value) || 200)),
                })
              }
            />
            <small>Higher DPI can improve OCR but costs more CPU and memory.</small>
          </label>
        </div>

        <details className="settings-advanced-panel">
          <summary>Advanced OCR limits</summary>
          <div className="settings-advanced-content">
            <div className="settings-two-column settings-field-grid">
              <label className="settings-field">
                <span>Timeout seconds</span>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={ocrDraft.timeoutSeconds}
                  onChange={(event) =>
                    setOcrDraft({
                      ...ocrDraft,
                      timeoutSeconds: Math.min(600, Math.max(1, Number(event.target.value) || 60)),
                    })
                  }
                />
              </label>

              <label className="settings-field">
                <span>Max pages per file</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={ocrDraft.maxPagesPerFile}
                  onChange={(event) =>
                    setOcrDraft({
                      ...ocrDraft,
                      maxPagesPerFile: Math.min(200, Math.max(1, Number(event.target.value) || 20)),
                    })
                  }
                />
              </label>
            </div>

            <label className="settings-field">
              <span>Temporary OCR directory</span>
              <input
                value={ocrDraft.tempDir ?? ""}
                placeholder="System temporary directory"
                onChange={(event) => setOcrDraft({ ...ocrDraft, tempDir: event.target.value })}
              />
              <small>Temporary rasterized page images are removed after OCR.</small>
            </label>
          </div>
        </details>

        <div className="settings-placeholder">
          <strong>Setup help</strong>
          <span>macOS Homebrew: `brew install tesseract poppler`</span>
          <span>Optional languages: `brew install tesseract-lang` or install only the language packs you need.</span>
          <span>Windows support is planned later through explicit local paths or a future bundled runtime.</span>
        </div>

        {ocrHealth && (
          <div className="settings-placeholder">
            <strong>Diagnostics</strong>
            <span>Provider: {ocrHealth.provider}</span>
            <span>Tesseract: {ocrHealth.commandPath ?? "Not detected"}</span>
            <span>Rasterizer: {ocrHealth.rasterizerCommandPath ?? "Not detected"}</span>
            <span>Language: {ocrHealth.language}</span>
            <span>DPI: {ocrHealth.dpi}</span>
            {ocrHealth.warnings.length > 0 && (
              <small>Warnings: {ocrHealth.warnings.join(", ")}</small>
            )}
          </div>
        )}

        <div className="settings-actions">
          <button type="button" onClick={() => void checkOcrProvider()} disabled={working === "ocr-check"}>
            <RefreshCw size={14} />
            {working === "ocr-check" ? "Checking OCR" : "Check OCR Runtime"}
          </button>
          <button type="button" onClick={() => void saveOcrConfig()} disabled={!canSave}>
            <CheckCircle2 size={14} />
            {working === "ocr-config" ? "Saving" : "Save OCR Settings"}
          </button>
        </div>
      </section>
    );
  }

  function renderCapabilitySettings() {
    const capability = serviceStatus.capability;
    const models = capability?.models ?? [];
    const compactModels = models.slice(0, 3).map((model) => model.modelName).join(", ");
    return (
      <>
        {renderSpeechToTextSettings()}
        {renderOcrRuntimeSettings()}

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Capability</span>
              <h3>System and strategy summary</h3>
            </div>
            <button
              type="button"
              className="download-model-button"
              onClick={() => void refreshServiceStatus()}
              disabled={serviceStatus.loading}
            >
              <RefreshCw size={13} />
              <span>{serviceStatus.loading ? "Refreshing" : "Refresh"}</span>
            </button>
          </div>
          <div className="service-status-grid">
            <div className="settings-placeholder">
              <strong>System</strong>
              <span>Status: {statusLabel(capability?.status)}</span>
              <span>
                Platform: {[capability?.system?.osName, capability?.system?.arch]
                  .filter(Boolean)
                  .join(" / ") || "Unknown"}
              </span>
              <span>Memory: {formatBytes(capability?.system?.totalMemoryBytes)}</span>
            </div>
            <div className="settings-placeholder">
              <strong>Models</strong>
              <span>
                Catalog: {models.length > 0 ? `${models.length} (${compactModels})` : "Unknown"}
              </span>
              <span>
                Strategy resolver: {capability?.strategyAvailable ? "Available" : "Not available"}
              </span>
            </div>
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Performance</span>
              <h3>Manual tuning</h3>
            </div>
            <span className="settings-planned-pill">Planned</span>
          </div>
          <div className="settings-placeholder settings-placeholder-disabled">
            <strong>Capability tuning remains service-owned</strong>
            <span>
              Local benchmarks, compatibility estimates, and provider discovery feed the service
              resolver. This screen does not add new routing or strategy controls.
            </span>
          </div>
        </section>
      </>
    );
  }

  function renderContextMemorySettings() {
    const memoryChanged = JSON.stringify(memoryDraft) !== JSON.stringify(appSettings.memory);
    return (
      <>
        <section className="provider-section memory-settings-section" data-testid="memory-settings-section">
          <div className="provider-section-heading">
            <div>
              <span>Memory</span>
              <h3>Memory</h3>
            </div>
          </div>
          <div className="memory-toggle-list" aria-label="Memory controls">
            <label className="settings-toggle memory-toggle">
              <input
                type="checkbox"
                checked={memoryDraft.enabled}
                onChange={(event) => updateMemoryDraft({ enabled: event.target.checked })}
              />
              <span>
                <strong>Use memory in Loom</strong>
                <small>Allow future memory features to participate in answers when enabled.</small>
              </span>
            </label>
            <label className="settings-toggle memory-toggle">
              <input
                type="checkbox"
                checked={memoryDraft.referenceRecentLooms}
                onChange={(event) =>
                  updateMemoryDraft({ referenceRecentLooms: event.target.checked })
                }
                disabled={!memoryDraft.enabled}
              />
              <span>
                <strong>Reference recent Looms</strong>
                <small>Use recent Loom context as derived session memory.</small>
              </span>
            </label>
            <label className="settings-toggle memory-toggle">
              <input
                type="checkbox"
                checked={memoryDraft.referenceSavedMemories}
                onChange={(event) =>
                  updateMemoryDraft({ referenceSavedMemories: event.target.checked })
                }
                disabled={!memoryDraft.enabled}
              />
              <span>
                <strong>Reference saved memories</strong>
                <small>Use explicit, user-approved saved memories when available.</small>
              </span>
            </label>
          </div>
          <div className="memory-actions settings-actions">
            <button
              type="button"
              data-testid="memory-save"
              onClick={() => void saveMemorySettings()}
              disabled={!memoryChanged}
            >
              Save
            </button>
            <button
              type="button"
              data-testid="memory-reset"
              onClick={resetMemorySettings}
              disabled={!memoryChanged}
            >
              Reset changes
            </button>
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Saved memories</span>
              <h3>Saved memories</h3>
            </div>
            <span className="settings-planned-pill">Shell only</span>
          </div>
          <div className="memory-empty-state" data-testid="memory-empty-state">
            <strong>No saved memories yet.</strong>
            <span>
              Saved memories will appear here only after explicit remember and forget controls are
              implemented.
            </span>
          </div>
          <div className="memory-actions settings-actions">
            <button type="button" disabled>
              Clear all memories
            </button>
            <button type="button" disabled>
              Export memories
            </button>
          </div>
          <small>
            This shell does not create memory rows, write memories automatically, or expose hidden
            reasoning.
          </small>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Profile</span>
              <h3>Your profile and preferences</h3>
            </div>
          </div>
          <div className="settings-two-column settings-field-grid">
            <label className="settings-field">
              <span>Your nickname</span>
              <input
                value={memoryDraft.nickname}
                onChange={(event) => updateMemoryDraft({ nickname: event.target.value })}
                placeholder="Optional"
              />
              <small>Displayed as a future explicit memory preference.</small>
            </label>
            <label className="settings-field">
              <span>Your occupation</span>
              <input
                value={memoryDraft.occupation}
                onChange={(event) => updateMemoryDraft({ occupation: event.target.value })}
                placeholder="Optional"
              />
              <small>Stored only with these frontend settings in this shell.</small>
            </label>
          </div>
          <label className="settings-field">
            <span>Language and style preferences</span>
            <textarea
              value={memoryDraft.stylePreferences}
              onChange={(event) => updateMemoryDraft({ stylePreferences: event.target.value })}
              placeholder="Tone, language, formatting, or response style preferences."
            />
          </label>
          <label className="settings-field">
            <span>More about you</span>
            <textarea
              value={memoryDraft.moreAboutYou}
              onChange={(event) => updateMemoryDraft({ moreAboutYou: event.target.value })}
              placeholder="Optional background you may later choose to save as explicit memory."
            />
          </label>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Privacy and retention</span>
              <h3>Memory boundaries</h3>
            </div>
          </div>
          <div className="memory-policy-grid">
            <div className="settings-placeholder">
              <strong>Explicit Memory</strong>
              <span>User-approved, durable, inspectable, editable, and deletable.</span>
            </div>
            <div className="settings-placeholder">
              <strong>Derived Context Artifacts</strong>
              <span>
                Capsules, checkpoints, retrieval summaries, and orchestration artifacts are context
                infrastructure, not saved memories.
              </span>
            </div>
            <div className="settings-placeholder">
              <strong>Raw model thinking is never saved as memory.</strong>
              <span>
                Hidden reasoning and internal monologue must not be persisted, exported, or reused.
              </span>
            </div>
          </div>
        </section>
      </>
    );
  }

  function renderPrivacySecuritySettings() {
    return (
      <>
        <section className="provider-section settings-posture-section">
          <div className="provider-section-heading">
            <div>
              <span>Security</span>
              <h3>Security posture</h3>
            </div>
          </div>
          <div className="settings-placeholder">
            <strong>Loom is designed to keep runtime data local-first.</strong>
            <span>
              Raw model thinking is never stored, reused, exported, or injected into future
              context.
            </span>
          </div>
          <div className="settings-posture-grid">
            {[
              ["Local-first runtime", "Enabled", "Policy"],
              ["Raw thinking persistence", "Disabled", "Policy"],
              ["Remote Ollama", "Blocked by default", "Policy"],
              ["Provider secrets", "Secure native storage required later", "Policy"],
              ["Unsafe model management", "Disabled by default", "Policy"],
            ].map(([label, value, source]) => (
              <div className="settings-posture-row" key={label}>
                <span>
                  <strong>{label}</strong>
                  <small>{source}</small>
                </span>
                <em>{value}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Provider security</span>
              <h3>Endpoint and secret policy</h3>
            </div>
          </div>
          <div
            className={`runtime-health-card ${
              runtimeHealth.ollama?.security?.localOnly ? "ready" : "degraded"
            }`}
          >
            <strong>Remote Ollama endpoints are blocked by default for safety.</strong>
            <span>
              Local-only: {runtimeHealth.ollama?.security?.localOnly ? "OK" : "Warning"}
            </span>
            {runtimeHealth.ollama?.security?.warnings?.slice(0, 2).map((warning) => (
              <small key={warning}>{warning}</small>
            ))}
          </div>
          <div className="settings-placeholder settings-placeholder-disabled">
            <strong>Provider secrets require secure native storage.</strong>
            <span>
              API keys are not accepted or stored in this Settings UI, renderer state, or config
              files.
            </span>
          </div>
        </section>
      </>
    );
  }

  function renderDataStorageSettings() {
    return (
      <>
        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Data</span>
              <h3>Local storage</h3>
            </div>
          </div>
          <div className="settings-placeholder">
            <strong>SQLite canonical store</strong>
            <span>
              Loom, Weft, Response, Reference, Bookmark, graph, context, and provider non-secret
              metadata are owned by loom-service.
            </span>
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Storage controls</span>
              <h3>Cleanup and data location</h3>
            </div>
            <span className="settings-planned-pill">Coming later</span>
          </div>
          <div className="settings-placeholder settings-placeholder-disabled">
            <strong>Data management controls are deferred</strong>
            <span>
              Local data location, cleanup, archive/delete, and import flows need service-owned
              product controls before they become active.
            </span>
          </div>
        </section>

        {onResetAllData && (
          <section className="provider-section settings-danger-zone">
            <div className="provider-section-heading">
              <div>
                <span>Danger zone</span>
                <h3>Reset all data</h3>
              </div>
            </div>
            {resetConfirm === "idle" && (
              <div className="settings-danger-idle">
                <span>
                  Permanently deletes all conversations, responses, bookmarks, and history.
                  This cannot be undone.
                </span>
                <button
                  className="settings-danger-button"
                  onClick={() => setResetConfirm("confirming")}
                >
                  Reset all data…
                </button>
              </div>
            )}
            {resetConfirm === "confirming" && (
              <div className="settings-danger-confirm">
                <div className="settings-danger-confirm-warning">
                  <AlertTriangle size={16} />
                  <strong>
                    All conversations, responses, bookmarks and history will be permanently deleted.
                    This action cannot be undone.
                  </strong>
                </div>
                <div className="settings-danger-confirm-actions">
                  <button onClick={() => setResetConfirm("idle")}>Cancel</button>
                  <button
                    className="settings-danger-confirm-button"
                    onClick={async () => {
                      setResetConfirm("working");
                      try {
                        await onResetAllData();
                      } finally {
                        setResetConfirm("idle");
                      }
                    }}
                  >
                    Yes, reset
                  </button>
                </div>
              </div>
            )}
            {resetConfirm === "working" && (
              <div className="settings-danger-idle">
                <span>Resetting…</span>
              </div>
            )}
          </section>
        )}
      </>
    );
  }

  function renderExportImportSettings() {
    return (
      <>
        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Export</span>
              <h3>Service export capabilities</h3>
            </div>
          </div>
          <div className="settings-placeholder">
            <strong>Graph-aware exports</strong>
            <span>
              Existing exports are routed through the engine/service boundary and must remain
              raw-thinking-safe.
            </span>
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Import</span>
              <h3>Import controls</h3>
            </div>
            <span className="settings-planned-pill">Coming later</span>
          </div>
          <div className="settings-placeholder settings-placeholder-disabled">
            <strong>Import is not active here yet</strong>
            <span>
              Import needs validated service-owned data boundaries before this Settings panel can
              expose controls.
            </span>
          </div>
        </section>
      </>
    );
  }

  function renderAdvancedSettings() {
    const health = serviceStatus.health;
    const config = serviceStatus.config;
    const capability = serviceStatus.capability;
    const models = capability?.models ?? [];
    const compactModels = models.slice(0, 3).map((model) => model.modelName).join(", ");

    const isMismatched =
      desktopRuntimeInfo?.isElectron &&
      health?.binaryFingerprint &&
      desktopRuntimeStatus?.expectedFingerprint &&
      health.binaryFingerprint !== desktopRuntimeStatus.expectedFingerprint;

    const freshnessInfo = desktopRuntimeInfo?.isElectron && health?.binaryFingerprint
      ? {
          label: isMismatched ? "⚠ runtime_binary_mismatch" : "✓ Fresh",
        }
      : null;

    return (
      <>
        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Loom</span>
              <h3>Diagnostics</h3>
            </div>
          </div>
          <div className="settings-placeholder">
            <strong>Build channel</strong>
            <span>Local prototype / development build</span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={appSettings.mockDataEnabled || isMockDataForced()}
              disabled={isMockDataForced()}
              onChange={(event) =>
                updateAppSettings({
                  ...appSettings,
                  mockDataEnabled: event.target.checked,
                })
              }
            />
            <span>Show mock Loom data in debug mode</span>
          </label>
          <small>
            When off, Loom starts as a clean first-run app with no built-in demo Looms,
            Responses, graph branches, history, or demo bookmarks. Mock data can still be forced
            for development with VITE_ENABLE_MOCK_DATA=true.
          </small>
          <div className="settings-actions">
            <button disabled>Documentation</button>
            <button disabled>Release notes</button>
            <button disabled>Report issue</button>
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Engine</span>
              <h3>Service status</h3>
            </div>
            <button
              type="button"
              className="download-model-button"
              onClick={() => void refreshServiceStatus()}
              disabled={serviceStatus.loading}
              aria-label={serviceStatus.loading ? "Refreshing service status" : "Refresh service status"}
              title={serviceStatus.loading ? "Refreshing service status" : "Refresh service status"}
            >
              <RefreshCw size={13} />
            </button>
          </div>

          <div className={`runtime-health-card ${health?.status ?? "degraded"}`}>
            <strong>
              {health?.runtime === "rust-service" ? "Rust Service" : "Service unavailable"}
              {" · "}
              {statusLabel(health?.status)}
            </strong>
            <span>
              Mode: {health?.runtime === "rust-service" ? "Rust Service" : "Service unavailable"}
              {health?.serviceUrl ? ` · ${health.serviceUrl}` : ""}
            </span>
            {health?.version && <span>Version: {health.version}</span>}
            {health?.database && <span>Database: {statusLabel(health.database.status)}</span>}
            {health?.config && <span>Config: {statusLabel(health.config.status)}</span>}
            {freshnessInfo && (
              <span>
                Runtime Freshness:{" "}
                <span
                  style={{
                    color: isMismatched ? "var(--accent)" : "var(--success)",
                    fontWeight: 500,
                  }}
                >
                  {freshnessInfo.label}
                </span>
              </span>
            )}
            {health?.providers?.ollama && (
              <>
                <span>
                  Ollama: {statusLabel(health.providers.ollama.status)}{" "}
                  {health.providers.ollama.version
                    ? `· ${health.providers.ollama.version}`
                    : ""}
                </span>
                <span>
                  {securityAccessLabel(
                    health.providers.ollama.security,
                    health.providers.ollama.baseUrl ?? draft.ollama.baseUrl
                  )}
                </span>
                <span>
                  {providerVersionLabel(health.providers.ollama.security?.versionStatus)}
                </span>
                {health.providers.ollama.security?.warnings?.slice(0, 2).map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
              </>
            )}
            {health?.error && <span>Start loom-service and refresh. {health.error}</span>}
          </div>

          <div className="service-status-grid">
            <div className="settings-placeholder">
              <strong>Config</strong>
              <span>Status: {statusLabel(config?.status)}</span>
              {config?.path && <span>Path: {config.path}</span>}
              <span>Restart required: {config?.restartRequired ? "Yes" : "No"}</span>
              <span>Pending restart: {config?.pendingRestart ? "Yes" : "No"}</span>
            </div>
            <div className="settings-placeholder">
              <strong>Capability</strong>
              <span>Status: {statusLabel(capability?.status)}</span>
              <span>
                System: {[capability?.system?.osName, capability?.system?.arch]
                  .filter(Boolean)
                  .join(" / ") || "Unknown"}
              </span>
              <span>Memory: {formatBytes(capability?.system?.totalMemoryBytes)}</span>
              <span>
                Models: {models.length > 0 ? `${models.length} (${compactModels})` : "Unknown"}
              </span>
            </div>
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Developer</span>
              <h3>Developer integrations — planned</h3>
            </div>
            <span className="settings-planned-pill">Planned</span>
          </div>
          <div className="settings-compact-planned-grid">
            {[
              ["Extensions", "Custom tools and local automations"],
              ["MCP", "Connector management for the future runtime"],
              ["Tool artifacts", "Service-owned tool output boundaries"],
            ].map(([title, description]) => (
              <div className="settings-compact-planned-item" key={title}>
                <strong>{title}</strong>
                <span>{description}</span>
                <em>Planned</em>
              </div>
            ))}
          </div>
        </section>
      </>
    );
  }

  function renderActiveCategory() {
    switch (activeCategory) {
      case "runtime":
        return renderRuntimeSettings();
      case "ai-providers":
        return renderAIProvidersSettings();
      case "models":
        return renderModelsSettings();
      case "capability":
        return renderCapabilitySettings();
      case "context-memory":
        return renderContextMemorySettings();
      case "privacy-security":
        return renderPrivacySecuritySettings();
      case "data-storage":
        return renderDataStorageSettings();
      case "export-import":
        return renderExportImportSettings();
      case "ui-preferences":
        return renderUiPreferencesSettings();
      case "shortcuts":
        return renderShortcutSettings();
      case "advanced":
        return renderAdvancedSettings();
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <section
        className="provider-settings settings-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="provider-settings-header">
          <div>
            <span>Settings</span>
            <h2 id="provider-settings-title">{activeCategoryLabel}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <X size={16} />
          </button>
        </header>

        <div className="provider-settings-body settings-layout">
          <aside className="settings-category-list" aria-label="Settings categories">
            {settingsCategories.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  className={`settings-category-row ${
                    activeCategory === category.id ? "active" : ""
                  }`}
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                >
                  <Icon size={15} />
                  <span>
                    <strong>{category.label}</strong>
                    <small>{category.description}</small>
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="provider-detail settings-content">{renderActiveCategory()}</div>
        </div>
      </section>
    </div>
  );
}
