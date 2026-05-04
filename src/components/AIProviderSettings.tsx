import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
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

const provider = new OllamaProvider();

export function AIProviderSettingsModal({
  settings,
  runtimeHealth,
  onSave,
  onClose,
}: {
  settings: AIProviderSettings;
  runtimeHealth: RuntimeHealthState & {
    checking: boolean;
    testRuntime: () => Promise<RuntimeHealthState>;
  };
  onSave: (settings: AIProviderSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const filteredModels = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return draft.ollama.models;
    return draft.ollama.models.filter((model) =>
      [model.name, model.id, model.location]
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

  const quickModel = getProfileModel(draft, "quick");
  const mainModel = getProfileModel(draft, "main");
  const selectedModelsReady = quickModel.installed && mainModel.installed;
  const demoResponsesAvailable = canUseMockResponseMode();
  const demoResponsesForced = import.meta.env.VITE_ENABLE_MOCK_RESPONSES === "true";
  const demoResponsesEnabled = isMockResponseModeEnabled(draft);
  const quickModelOptions = demoResponsesEnabled ? [quickModel] : draft.ollama.models;
  const mainModelOptions = demoResponsesEnabled ? [mainModel] : draft.ollama.models;

  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <section
        className="provider-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="provider-settings-header">
          <div>
            <span>Settings</span>
            <h2 id="provider-settings-title">AI Providers</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <X size={16} />
          </button>
        </header>

        <div className="provider-settings-body">
          <aside className="provider-list" aria-label="Model providers">
            <button className="provider-row active">
              <Server size={15} />
              <span>
                <strong>Ollama</strong>
                <small>Local</small>
              </span>
            </button>
            {["OpenAI", "Anthropic Claude", "Google Gemini", "OpenAI-compatible"].map((item) => (
              <button className="provider-row disabled" key={item} disabled>
                <Server size={15} />
                <span>
                  <strong>{item}</strong>
                  <small>Future provider</small>
                </span>
              </button>
            ))}
          </aside>

          <div className="provider-detail">
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
                <button
                  onClick={testConnection}
                  disabled={working === "test" || runtimeHealth.checking}
                >
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
                {!demoResponsesEnabled && !runtimeHealth.ollama_installed && (
                  <a
                    href="https://ollama.com/download"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Install Ollama
                  </a>
                )}
              </div>

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

            <section className="provider-section">
              <div className="provider-section-heading">
                <div>
                  <span>Models</span>
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
                {filteredModels.map((model) => (
                  <div className="provider-model-row" key={model.id}>
                    <span>
                      <strong>{model.name}</strong>
                      <small>{model.id}</small>
                      {model.location && <small>{model.location}</small>}
                    </span>
                    <em className={model.installed ? "installed" : "missing"}>
                      {model.installed ? "Installed" : "Not installed"}
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
                ))}
              </div>
            </section>

            <section className="provider-section provider-runtime-section">
              <label className="settings-field">
                <span>Context length</span>
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
                <small>{draft.ollama.contextLength.toLocaleString()} tokens</small>
              </label>
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
              {draft.ollama.modelLocation && (
                <div className="model-location">
                  <span>Model location</span>
                  <strong>{draft.ollama.modelLocation}</strong>
                </div>
              )}
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
