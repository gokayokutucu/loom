import { useEffect, useMemo, useState } from "react";
import {
  Accessibility,
  Bell,
  Bot,
  Box,
  CheckCircle2,
  Download,
  Info,
  Palette,
  Plug,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
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
import type {
  AccessibilitySettings,
  AppSettings,
  NotificationSettings,
  StartupSettings,
} from "../services/appSettings";
import type {
  CapabilitySummary,
  LoomEngineClient,
  ServiceConfigStatus,
  ServiceHealthStatus,
} from "../engine";

const provider = new OllamaProvider();

type SettingsCategoryId =
  | "general"
  | "ai-providers"
  | "models"
  | "appearance"
  | "notifications"
  | "startup"
  | "extensions"
  | "mcp-connectors"
  | "accessibility"
  | "about";

const settingsCategories: Array<{
  id: SettingsCategoryId;
  label: string;
  description: string;
  icon: typeof Settings;
}> = [
  { id: "general", label: "General", description: "Composer and Loom behavior", icon: Settings },
  { id: "ai-providers", label: "AI Providers", description: "Runtime connections", icon: Server },
  { id: "models", label: "Models", description: "Quick and Main models", icon: Bot },
  { id: "appearance", label: "Appearance", description: "Theme preferences", icon: Palette },
  { id: "notifications", label: "Notifications", description: "Loom alerts", icon: Bell },
  { id: "startup", label: "Startup", description: "Launch behavior", icon: SlidersHorizontal },
  { id: "extensions", label: "Extensions", description: "Extension Pipeline", icon: Box },
  { id: "mcp-connectors", label: "MCP Connectors", description: "Tool connections", icon: Plug },
  { id: "accessibility", label: "Accessibility", description: "Comfort controls", icon: Accessibility },
  { id: "about", label: "About", description: "Prototype details", icon: Info },
];

const futureProviders = ["OpenAI", "Anthropic Claude", "Google Gemini", "OpenAI-compatible"];

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
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<{
    health?: ServiceHealthStatus;
    config?: ServiceConfigStatus;
    capability?: CapabilitySummary;
    loading: boolean;
  }>({ loading: false });

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  async function refreshServiceStatus() {
    setServiceStatus((current) => ({ ...current, loading: true }));
    const [health, config, capability] = await Promise.all([
      engineClient.getServiceHealth(),
      engineClient.getServiceConfigStatus(),
      engineClient.getCapabilitySummary(),
    ]);
    setServiceStatus({ health, config, capability, loading: false });
  }

  useEffect(() => {
    if (activeCategory === "about" && !serviceStatus.health && !serviceStatus.loading) {
      void refreshServiceStatus();
    }
  }, [activeCategory, serviceStatus.health, serviceStatus.loading]);

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

  function renderGeneralSettings() {
    return (
      <>
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

        <section className="provider-section settings-two-column">
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
          ["reopenLastLooms", "Reopen last Looms on startup"],
          ["runtimeCheckOnLaunch", "Start local runtime check on launch"],
          ["showNewLoomIfNoSession", "Show New Loom on startup if no session restored"],
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
        <small>OS-level login integration is not enabled in this prototype.</small>
      </section>
    );
  }

  function renderExtensionsSettings() {
    return (
      <section className="provider-section">
        <div className="provider-section-heading">
          <div>
            <span>Extension Pipeline</span>
            <h3>Extensions</h3>
          </div>
        </div>
        <div className="settings-placeholder">
          <strong>Coming soon</strong>
          <span>Extensions will let Loom connect custom tools, workflows, and local automations.</span>
        </div>
      </section>
    );
  }

  function renderMcpSettings() {
    return (
      <section className="provider-section">
        <div className="provider-section-heading">
          <div>
            <span>MCP</span>
            <h3>MCP Connectors</h3>
          </div>
        </div>
        <div className="settings-placeholder">
          <strong>No connectors configured</strong>
          <span>Connector management is reserved for the upcoming MCP runtime.</span>
          <button disabled>Add Connector</button>
        </div>
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

  function renderAboutSettings() {
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
              <h3>Local prototype</h3>
            </div>
          </div>
          <div className="settings-placeholder">
            <strong>Build channel</strong>
            <span>Local prototype / development build</span>
          </div>
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
            >
              <RefreshCw size={13} />
              <span>{serviceStatus.loading ? "Refreshing" : "Refresh service status"}</span>
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
      </>
    );
  }

  function renderActiveCategory() {
    switch (activeCategory) {
      case "general":
        return renderGeneralSettings();
      case "ai-providers":
        return renderAIProvidersSettings();
      case "models":
        return renderModelsSettings();
      case "appearance":
        return renderAppearanceSettings();
      case "notifications":
        return renderNotificationsSettings();
      case "startup":
        return renderStartupSettings();
      case "extensions":
        return renderExtensionsSettings();
      case "mcp-connectors":
        return renderMcpSettings();
      case "accessibility":
        return renderAccessibilitySettings();
      case "about":
        return renderAboutSettings();
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
