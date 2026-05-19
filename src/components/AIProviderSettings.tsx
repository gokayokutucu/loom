import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Database,
  Download,
  Info,
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
  OllamaProvider,
  type AIProviderSettings,
  type ModelDescriptor,
  type ModelProfileId,
  type RuntimeHealthState,
} from "../services/modelProviders";
import {
  isMockDataForced,
  type AccessibilitySettings,
  type AppSettings,
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
  type LoomDesktopRuntimeStatus,
} from "../electronRuntime";
import type {
  CapabilitySummary,
  LoomEngineClient,
  LoomServiceRuntimeConfig,
  ServiceConfigStatus,
  ServiceHealthStatus,
  SpeechProviderHealth,
  SpeechToTextProviderKind,
  SpeechToTextRuntimeConfig,
} from "../engine";

const provider = new OllamaProvider();

type SettingsCategoryId =
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
  { id: "context-memory", label: "Context & Memory", description: "Recent turns, retrieval, local memory", icon: Workflow },
  { id: "privacy-security", label: "Privacy & Security", description: "Local-first and raw-thinking protections", icon: ShieldCheck },
  { id: "data-storage", label: "Data & Storage", description: "SQLite and local data", icon: Database },
  { id: "export-import", label: "Export / Import", description: "Portable Loom data", icon: Download },
  { id: "ui-preferences", label: "UI Preferences", description: "Display and comfort", icon: Palette },
  { id: "shortcuts", label: "Shortcuts", description: "Browser-style keyboard commands", icon: Search },
  { id: "advanced", label: "Advanced", description: "Diagnostics, config, developer plans", icon: Info },
];

const futureProviders = ["OpenAI", "Anthropic Claude", "Google Gemini", "OpenAI-compatible"];

const defaultSpeechConfigDraft: SpeechToTextRuntimeConfig = {
  enabled: true,
  defaultProviderKind: "local_command",
  allowCloudStt: false,
  persistAudio: false,
  persistTranscript: false,
  maxAudioBytes: 10 * 1024 * 1024,
  allowedMimeTypes: ["audio/webm", "audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg"],
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

function speechArgsText(args: string[]) {
  return args.join("\n");
}

function parseSpeechArgs(value: string) {
  return value
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function AIProviderSettingsModal({
  settings,
  appSettings,
  runtimeHealth,
  engineClient,
  onSave,
  onAppSettingsSave,
  onClose,
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
}) {
  const [draft, setDraft] = useState(settings);
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("runtime");
  const [query, setQuery] = useState("");
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<{
    health?: ServiceHealthStatus;
    config?: ServiceConfigStatus;
    serviceConfig?: LoomServiceRuntimeConfig;
    configError?: string;
    speechHealth?: SpeechProviderHealth;
    speechHealthError?: string;
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

  const desktopRuntimeInfo = getElectronRuntimeInfo();
  const desktopRuntimeBridge = getElectronRuntimeBridge();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  async function refreshServiceStatus() {
    setServiceStatus((current) => ({ ...current, loading: true }));
    const [health, config, capability, speechHealthResult, serviceConfigResult] = await Promise.all([
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
        .getServiceConfig()
        .then((serviceConfig) => ({ serviceConfig }))
        .catch((error: unknown) => ({
          configError:
            error instanceof Error ? error.message : "loom-service config is unavailable.",
        })),
    ]);
    setServiceStatus({
      health,
      config,
      capability,
      serviceConfig: "serviceConfig" in serviceConfigResult ? serviceConfigResult.serviceConfig : undefined,
      configError: "configError" in serviceConfigResult ? serviceConfigResult.configError : undefined,
      speechHealth: "speechHealth" in speechHealthResult ? speechHealthResult.speechHealth : undefined,
      speechHealthError:
        "speechHealthError" in speechHealthResult ? speechHealthResult.speechHealthError : undefined,
      loading: false,
    });
  }

  async function refreshDesktopRuntimeStatus() {
    if (!desktopRuntimeBridge) {
      setDesktopRuntimeStatus({
        state: "unavailable",
        startedByElectron: false,
        error: "Runtime restart is available in the desktop app.",
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
  }, [serviceStatus.serviceConfig]);

  useEffect(() => {
    if (
      ["runtime", "capability", "advanced"].includes(activeCategory) &&
      !serviceStatus.health &&
      !serviceStatus.loading
    ) {
      void refreshServiceStatus();
    }
  }, [activeCategory, serviceStatus.health, serviceStatus.loading]);

  useEffect(() => {
    if (activeCategory !== "runtime" && activeCategory !== "advanced") return;
    void refreshDesktopRuntimeStatus();
  }, [activeCategory]);

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
      const models = await provider.refreshModels(draft);
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
      await provider.pullModel(draft, model.id);
      let models = mergeOllamaModels([
        ...draft.ollama.models,
        { ...model, installed: true, location: draft.ollama.modelLocation },
      ]);
      try {
        models = await provider.refreshModels(draft);
      } catch {
        // Keep the optimistic installed state if refresh fails after a successful pull.
      }
      update({ ...draft, ollama: { ...draft.ollama, models } });
      setMessage(`${model.name} is installed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not pull ${model.name}.`);
    } finally {
      setWorking(null);
    }
  }

  function setProfile(profile: ModelProfileId, modelId: string) {
    update({
      ...draft,
      profiles: {
        ...draft.profiles,
        [profile === "quick" ? "quickModelId" : "mainModelId"]: modelId,
      },
    });
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

  const activeCategoryLabel =
    settingsCategories.find((category) => category.id === activeCategory)?.label ?? "Settings";
  const quickModel = getProfileModel(draft, "quick");
  const mainModel = getProfileModel(draft, "main");
  const selectedModelsReady = quickModel.installed && mainModel.installed;
  const demoResponsesAvailable = canUseMockResponseMode();
  const demoResponsesForced = import.meta.env.VITE_ENABLE_MOCK_RESPONSES === "true";
  const demoResponsesEnabled = isMockResponseModeEnabled(draft);
  const quickModelOptions = demoResponsesEnabled ? [quickModel] : draft.ollama.models;
  const mainModelOptions = demoResponsesEnabled ? [mainModel] : draft.ollama.models;

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

        {renderNotificationsSettings()}
        {renderAccessibilitySettings()}
        {renderStartupSettings()}
      </>
    );
  }

  function renderAIProvidersSettings() {
    return (
      <>
        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Ollama</span>
              <h3>Local model provider</h3>
            </div>
            <span className={`connection-pill ${draft.ollama.lastConnectionStatus}`}>
              {draft.ollama.lastConnectionStatus}
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
              Test Runtime
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

          <div className={`runtime-health-card ${runtimeHealth.status}`}>
            <strong>
              {demoResponsesEnabled
                ? "Demo responses enabled"
                : !runtimeHealth.ollama_installed
                  ? "Install Ollama"
                  : !runtimeHealth.models_available
                    ? "Pull Model"
                    : selectedModelsReady
                      ? "Runtime ready"
                      : "Download selected model"}
            </strong>
            <span>{runtimeHealth.message}</span>
            {runtimeHealth.checkedAt && (
              <small>Last checked {new Date(runtimeHealth.checkedAt).toLocaleTimeString()}</small>
            )}
            {runtimeHealth.ollama?.version && (
              <span>Ollama version: {runtimeHealth.ollama.version}</span>
            )}
            {runtimeHealth.ollama?.security && (
              <>
                <span>
                  Local-only: {runtimeHealth.ollama.security.localOnly ? "OK" : "Warning"}
                  {" · "}
                  Security: {runtimeHealth.ollama.security.versionStatus ?? "unknown"}
                </span>
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
              <span>Security</span>
              <h3>Provider secrets</h3>
            </div>
            <span className="settings-planned-pill">Planned</span>
          </div>
          <div className="settings-placeholder settings-placeholder-disabled">
            <strong>Secure native storage required</strong>
            <span>
              API keys and provider secrets are not stored in this Settings screen. Secret entry is
              deferred until a secure native storage flow exists.
            </span>
          </div>
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

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Future providers</span>
              <h3>Provider connections</h3>
            </div>
          </div>
          <div className="settings-provider-card-grid">
            {futureProviders.map((item) => (
              <div className="settings-provider-card disabled" key={item}>
                <Server size={15} />
                <span>
                  <strong>{item}</strong>
                  <small>Connection controls will appear here.</small>
                </span>
                <em>Future</em>
              </div>
            ))}
          </div>
        </section>
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
                        : model.installed
                          ? "installed"
                          : "missing"
                    }
                  >
                    {selectedButUnavailable
                      ? "Runtime unavailable"
                      : model.installed
                        ? "Available"
                        : "Missing"}
                  </em>
                  {!model.installed && (
                    <button
                      className="download-model-button"
                      onClick={() => pullModel(model)}
                      disabled={working === model.id}
                      aria-label={`Download ${model.name}`}
                      title="Download"
                    >
                      <Download size={14} />
                    </button>
                  )}
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
              {health?.runtime === "rust-service" ? "Rust Service" : "Runtime"}
              {" · "}
              {statusLabel(health?.status ?? runtimeHealth.status)}
            </strong>
            <span>
              Product mode uses the Rust-service engine boundary when service mode is enabled. No
              TypeScript runtime fallback is introduced here.
            </span>
            <span>{runtimeHealth.message}</span>
            {health?.serviceUrl && <span>Service URL: {health.serviceUrl}</span>}
            {health?.database && <span>Database: {statusLabel(health.database.status)}</span>}
            {health?.config && <span>Config: {statusLabel(health.config.status)}</span>}
            {health?.error && <span>Start loom-service and refresh. {health.error}</span>}
          </div>

          <div className="settings-actions">
            <button onClick={testConnection} disabled={working === "test" || runtimeHealth.checking}>
              <CheckCircle2 size={14} />
              Test Runtime
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

          <div className={`runtime-health-card ${desktopStatus === "ready" ? "ready" : "degraded"}`}>
            <strong>
              Runtime: loom-service · {statusLabel(desktopStatus)}
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
            {desktopRuntimeStatus?.lastCheckedAt && (
              <span>
                Last checked: {new Date(desktopRuntimeStatus.lastCheckedAt).toLocaleTimeString()}
              </span>
            )}
            {desktopRuntimeStatus?.error && <span>{desktopRuntimeStatus.error}</span>}
            {!desktopRuntimeBridge && (
              <span>Runtime restart is available in the desktop app.</span>
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
              <span>Ollama: {statusLabel(runtimeHealth.status)}</span>
              <span>
                Last checked:{" "}
                {runtimeHealth.checkedAt
                  ? new Date(runtimeHealth.checkedAt).toLocaleTimeString()
                  : "Not checked"}
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
          : "Local speech-to-text provider is not configured.";
    const unavailable = serviceStatus.configError ?? (!hasConfig ? "Service config is not loaded." : null);
    const canSave = hasConfig && !serviceStatus.configError && working !== "speech-config";
    const speechHealth = serviceStatus.speechHealth;
    const providerOptions: Array<{ value: SpeechToTextProviderKind; label: string }> = [
      { value: "local_command", label: "Local command" },
      { value: "disabled", label: "Disabled" },
    ];

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

        <div className="settings-placeholder">
          <strong>{providerStatus}</strong>
          <span>
            Choose a local transcription command, such as a local Whisper-compatible binary.
            Microphone input will work after the local command is configured.
          </span>
          <span>
            Loom does not install Whisper automatically. Install a local binary first, then configure
            its path and arguments here.
          </span>
          {unavailable && <span>{unavailable}</span>}
          {serviceStatus.speechHealthError && <span>{serviceStatus.speechHealthError}</span>}
          {speechHealth && (
            <span>
              Provider check: {speechHealth.status} · {speechHealth.message}
            </span>
          )}
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
          <small>Path to a local executable. Loom does not install STT binaries.</small>
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

        <div className="settings-placeholder">
          <strong>whisper.cpp example</strong>
          <span>Command path: /path/to/whisper-cli</span>
          <span>Arguments, one per line: -m /path/to/ggml-base.en.bin -f {"{input}"} -otxt -of {"{output}"}</span>
          <span>Output mode: Transcript file · Extension: txt</span>
        </div>

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

        <div className="settings-placeholder">
          <strong>Privacy posture</strong>
          <span>Local-only STT configuration. Cloud STT is not enabled.</span>
          <span>Raw audio is not persisted by default.</span>
          <span>Transcripts are not persisted separately by default.</span>
          <span>Transcribed text is inserted into the composer draft and is never auto-sent.</span>
        </div>

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
    return (
      <>
        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Context</span>
              <h3>Local conversation memory</h3>
            </div>
          </div>
          <div className="settings-placeholder">
            <strong>Loom stores conversation memory locally in SQLite.</strong>
            <span>
              Recent turns, References, response parts, capsules, checkpoints, tags, graph links,
              and retrieval candidates are assembled by the Rust-service ContextManager.
            </span>
          </div>
          <div className="settings-placeholder">
            <strong>Raw model thinking is never stored or reused as future context.</strong>
            <span>
              Only visible answer content and safe status metadata can participate in future context.
            </span>
          </div>
        </section>

        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Memory controls</span>
              <h3>User memory settings</h3>
            </div>
            <span className="settings-planned-pill">Coming later</span>
          </div>
          <div className="settings-placeholder settings-placeholder-disabled">
            <strong>Explicit remember / forget policy required</strong>
            <span>
              Memory write, inspect, delete, and provenance controls are deferred until the
              auditable memory policy is accepted.
            </span>
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
    return (
      <>
        <section className="provider-section">
          <div className="provider-section-heading">
            <div>
              <span>Loom AI</span>
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
              checked={appSettings.showGenerationDebug}
              onChange={(event) =>
                updateAppSettings({
                  ...appSettings,
                  showGenerationDebug: event.target.checked,
                })
              }
            />
            <span>Show generation debug monitor while answering</span>
          </label>
          <small>
            Shows safe generation metadata during active responses. It does not expose or store raw
            model thinking.
          </small>
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
              {health?.runtime === "rust-service" ? "Rust Service" : "TypeScript Local"}
              {" · "}
              {statusLabel(health?.status)}
            </strong>
            <span>
              Mode: {health?.runtime === "rust-service" ? "Rust Service" : "TypeScript Local"}
              {health?.serviceUrl ? ` · ${health.serviceUrl}` : ""}
            </span>
            {health?.version && <span>Version: {health.version}</span>}
            {health?.database && <span>Database: {statusLabel(health.database.status)}</span>}
            {health?.config && <span>Config: {statusLabel(health.config.status)}</span>}
            {health?.providers?.ollama && (
              <>
                <span>
                  Ollama: {statusLabel(health.providers.ollama.status)}{" "}
                  {health.providers.ollama.version
                    ? `· ${health.providers.ollama.version}`
                    : ""}
                </span>
                <span>
                  Local-only:{" "}
                  {health.providers.ollama.security?.localOnly ? "OK" : "Warning"}
                  {health.providers.ollama.security?.versionStatus
                    ? ` · Security: ${health.providers.ollama.security.versionStatus}`
                    : ""}
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
