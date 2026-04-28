export type ModelProviderKind =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "openai-compatible";

export type ModelProfileId = "quick" | "main";

export interface ModelDescriptor {
  id: string;
  name: string;
  provider: ModelProviderKind;
  installed: boolean;
  size?: string;
  modifiedAt?: string;
  location?: string;
}

export interface OllamaSettings {
  enabled: boolean;
  baseUrl: string;
  exposeToNetwork: boolean;
  contextLength: number;
  modelLocation?: string;
  models: ModelDescriptor[];
  lastConnectionStatus: "unknown" | "connected" | "offline";
  lastCheckedAt?: string;
}

export interface ModelProfileSettings {
  quickModelId: string;
  mainModelId: string;
  activeComposerProfile: ModelProfileId;
}

export interface AIProviderSettings {
  activeProvider: ModelProviderKind;
  ollama: OllamaSettings;
  profiles: ModelProfileSettings;
}

export interface ModelProvider {
  kind: ModelProviderKind;
  label: string;
  testConnection(settings: AIProviderSettings): Promise<boolean>;
  refreshModels(settings: AIProviderSettings): Promise<ModelDescriptor[]>;
  pullModel(settings: AIProviderSettings, modelId: string): Promise<void>;
  execute(settings: AIProviderSettings, request: ModelExecutionRequest): Promise<ModelExecutionResult>;
}

export type ModelEffort = "Low" | "Medium" | "High";

export interface ModelExecutionRequest {
  profile: ModelProfileId;
  modelId: string;
  prompt: string;
  system?: string;
  context?: string[];
  effort?: ModelEffort;
}

export interface ModelExecutionResult {
  provider: ModelProviderKind;
  modelId: string;
  text: string;
}

export class ModelProviderError extends Error {
  provider: ModelProviderKind;
  code:
    | "provider_unavailable"
    | "model_missing"
    | "provider_not_implemented"
    | "request_failed";

  constructor(
    provider: ModelProviderKind,
    code: ModelProviderError["code"],
    message: string
  ) {
    super(message);
    this.name = "ModelProviderError";
    this.provider = provider;
    this.code = code;
  }
}

const SETTINGS_KEY = "loom-ai-provider-settings-v1";

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";

const suggestedOllamaModels: ModelDescriptor[] = [
  { id: "llama3.2:3b", name: "Llama 3.2 3B", provider: "ollama", installed: false },
  { id: "llama3.1:8b", name: "Llama 3.1 8B", provider: "ollama", installed: false },
  { id: "qwen2.5:7b", name: "Qwen 2.5 7B", provider: "ollama", installed: false },
  { id: "mistral:7b", name: "Mistral 7B", provider: "ollama", installed: false },
  { id: "nomic-embed-text", name: "Nomic Embed Text", provider: "ollama", installed: false },
];

export const defaultAIProviderSettings: AIProviderSettings = {
  activeProvider: "ollama",
  ollama: {
    enabled: true,
    baseUrl: OLLAMA_DEFAULT_BASE_URL,
    exposeToNetwork: false,
    contextLength: 8192,
    modelLocation: "~/.ollama/models",
    models: suggestedOllamaModels,
    lastConnectionStatus: "unknown",
  },
  profiles: {
    quickModelId: "llama3.2:3b",
    mainModelId: "llama3.1:8b",
    activeComposerProfile: "main",
  },
};

function mergeSettings(value: Partial<AIProviderSettings>): AIProviderSettings {
  return {
    ...defaultAIProviderSettings,
    ...value,
    ollama: {
      ...defaultAIProviderSettings.ollama,
      ...value.ollama,
      models: value.ollama?.models?.length
        ? mergeOllamaModels(value.ollama.models)
        : defaultAIProviderSettings.ollama.models,
    },
    profiles: {
      ...defaultAIProviderSettings.profiles,
      ...value.profiles,
    },
  };
}

export function readAIProviderSettings(): AIProviderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultAIProviderSettings;
    return mergeSettings(JSON.parse(raw) as Partial<AIProviderSettings>);
  } catch {
    return defaultAIProviderSettings;
  }
}

export function writeAIProviderSettings(settings: AIProviderSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function resetAIProviderSettings() {
  writeAIProviderSettings(defaultAIProviderSettings);
  return defaultAIProviderSettings;
}

export function mergeOllamaModels(models: ModelDescriptor[]) {
  const byId = new Map<string, ModelDescriptor>();
  suggestedOllamaModels.forEach((model) => byId.set(model.id, model));
  models.forEach((model) => byId.set(model.id, model));
  return Array.from(byId.values());
}

export function getInstalledModels(settings: AIProviderSettings) {
  return settings.ollama.models.filter((model) => model.installed);
}

export function getProfileModel(settings: AIProviderSettings, profile: ModelProfileId) {
  const modelId =
    profile === "quick"
      ? settings.profiles.quickModelId
      : settings.profiles.mainModelId;
  return (
    settings.ollama.models.find((model) => model.id === modelId) ?? {
      id: modelId,
      name: modelId,
      provider: settings.activeProvider,
      installed: false,
    }
  );
}

export function getComposerModelLabel(settings: AIProviderSettings) {
  const profile = settings.profiles.activeComposerProfile;
  const model = getProfileModel(settings, profile);
  return `${profile === "quick" ? "Quick" : "Main"} · ${model.name}`;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

function effortOptions(effort: ModelEffort | undefined) {
  if (effort === "Low") return { temperature: 0.2, num_ctx: 4096 };
  if (effort === "High") return { temperature: 0.45, num_ctx: 16384 };
  return { temperature: 0.3, num_ctx: 8192 };
}

function providerUnavailableMessage(baseUrl: string) {
  return `Ollama is not reachable at ${baseUrl}. Start Ollama locally or update the base URL in AI Providers.`;
}

export class OllamaProvider implements ModelProvider {
  kind: ModelProviderKind = "ollama";
  label = "Ollama";

  async testConnection(settings: AIProviderSettings) {
    const response = await fetch(`${normalizeBaseUrl(settings.ollama.baseUrl)}/api/version`);
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    return true;
  }

  async refreshModels(settings: AIProviderSettings) {
    const response = await fetch(`${normalizeBaseUrl(settings.ollama.baseUrl)}/api/tags`);
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = (await response.json()) as {
      models?: Array<{
        name: string;
        size?: number;
        modified_at?: string;
      }>;
    };
    const installed =
      data.models?.map((model) => ({
        id: model.name,
        name: model.name,
        provider: "ollama" as const,
        installed: true,
        size: model.size ? formatBytes(model.size) : undefined,
        modifiedAt: model.modified_at,
        location: settings.ollama.modelLocation,
      })) ?? [];
    return mergeOllamaModels(installed);
  }

  async pullModel(settings: AIProviderSettings, modelId: string) {
    const response = await fetch(`${normalizeBaseUrl(settings.ollama.baseUrl)}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, stream: false }),
    });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  }

  async execute(settings: AIProviderSettings, request: ModelExecutionRequest) {
    const model = settings.ollama.models.find((item) => item.id === request.modelId);
    if (model && !model.installed) {
      throw new ModelProviderError(
        "ollama",
        "model_missing",
        `${model.name} is not installed. Pull it from AI Providers, then try again.`
      );
    }

    const baseUrl = normalizeBaseUrl(settings.ollama.baseUrl);
    const options = {
      ...effortOptions(request.effort),
      num_ctx: settings.ollama.contextLength,
    };

    try {
      const chatResponse = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.modelId,
          stream: false,
          options,
          messages: [
            ...(request.system ? [{ role: "system", content: request.system }] : []),
            ...(request.context?.map((content) => ({ role: "user", content })) ?? []),
            { role: "user", content: request.prompt },
          ],
        }),
      });

      if (chatResponse.ok) {
        const data = (await chatResponse.json()) as { message?: { content?: string } };
        return {
          provider: this.kind,
          modelId: request.modelId,
          text: data.message?.content?.trim() || "The model returned an empty response.",
        };
      }

      const generateResponse = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.modelId,
          stream: false,
          prompt: [request.system, ...(request.context ?? []), request.prompt]
            .filter(Boolean)
            .join("\n\n"),
          options,
        }),
      });

      if (!generateResponse.ok) {
        throw new ModelProviderError(
          "ollama",
          "request_failed",
          `Ollama returned ${generateResponse.status}.`
        );
      }

      const data = (await generateResponse.json()) as { response?: string };
      return {
        provider: this.kind,
        modelId: request.modelId,
        text: data.response?.trim() || "The model returned an empty response.",
      };
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      throw new ModelProviderError(
        "ollama",
        "provider_unavailable",
        providerUnavailableMessage(baseUrl)
      );
    }
  }
}

class FutureProvider implements ModelProvider {
  constructor(
    readonly kind: Exclude<ModelProviderKind, "ollama">,
    readonly label: string
  ) {}

  async testConnection(): Promise<boolean> {
    throw new ModelProviderError(
      this.kind,
      "provider_not_implemented",
      `${this.label} is configured as a future provider stub in this prototype.`
    );
  }

  async refreshModels() {
    return [];
  }

  async pullModel() {
    throw new ModelProviderError(
      this.kind,
      "provider_not_implemented",
      `${this.label} model installation is not implemented in the browser prototype.`
    );
  }

  async execute(): Promise<ModelExecutionResult> {
    throw new ModelProviderError(
      this.kind,
      "provider_not_implemented",
      `${this.label} runtime execution is a typed stub for a later phase.`
    );
  }
}

export function getModelProvider(kind: ModelProviderKind): ModelProvider {
  if (kind === "ollama") return new OllamaProvider();
  if (kind === "openai") return new FutureProvider("openai", "OpenAI");
  if (kind === "anthropic") return new FutureProvider("anthropic", "Anthropic Claude");
  if (kind === "gemini") return new FutureProvider("gemini", "Google Gemini");
  return new FutureProvider("openai-compatible", "OpenAI-compatible provider");
}

export async function runModelProfileRequest(
  settings: AIProviderSettings,
  request: Omit<ModelExecutionRequest, "modelId">
) {
  const profileModel = getProfileModel(settings, request.profile);
  return getModelProvider(profileModel.provider).execute(settings, {
    ...request,
    modelId: profileModel.id,
  });
}

function formatBytes(value: number) {
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
