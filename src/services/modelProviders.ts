/*
 * Runtime model execution helpers in this module are legacy/dev/test-only after
 * the Rust-authoritative cutover. UI settings/types may remain product-adjacent,
 * but product model execution must go through
 * LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import { detectThinkingLoop } from "./thinkingGuard";

export type ModelProviderKind =
  | "ollama"
  | "mock"
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

export type RuntimeHealthStatus = "unknown" | "ready" | "not_running" | "degraded";
export type OllamaRuntimeErrorKind =
  | "runtime_unavailable"
  | "model_missing"
  | "tags_unavailable"
  | "probe_timeout"
  | "stream_failed"
  | "unsafe_remote"
  | "unknown";

export interface OllamaRuntimeHealth {
  runtimeReachable: boolean;
  version?: string;
  tagsReachable: boolean;
  availableModels: string[];
  selectedModelAvailable: boolean;
  lastCheckedAt?: string;
  lastErrorKind?: OllamaRuntimeErrorKind;
  stale: boolean;
  security?: {
    localOnly: boolean;
    networkExposureRisk: "low" | "high" | "unknown";
    versionStatus?: "ok" | "vulnerable" | "unknown" | "unavailable";
    warnings: string[];
  };
}

export interface RuntimeHealthState {
  ollama_installed: boolean;
  ollama_running: boolean;
  models_available: boolean;
  selected_model_ready: boolean;
  status: RuntimeHealthStatus;
  message: string;
  checkedAt?: string;
  ollama?: OllamaRuntimeHealth;
}

export interface ModelProfileSettings {
  quickModelId: string;
  mainModelId: string;
  mainProviderProfileId?: string;
  quickProviderProfileId?: string;
  mainProviderDisplayName?: string;
  mainProviderKind?: ModelProviderKind;
}

export interface DemoProviderSettings {
  mockResponsesEnabled: boolean;
}

export interface AIProviderSettings {
  activeProvider: ModelProviderKind;
  ollama: OllamaSettings;
  profiles: ModelProfileSettings;
  demo: DemoProviderSettings;
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
export type OllamaContextMode = "auto" | "instant" | "thinking";
export type ModelOutputBudget = "short" | "medium" | "long" | "extended";

export interface ModelExecutionRequest {
  profile: ModelProfileId;
  modelId: string;
  prompt: string;
  system?: string;
  context?: string[];
  referenceCount?: number;
  referenceCharCount?: number;
  messageCount?: number;
  effort?: ModelEffort;
  mode?: OllamaContextMode;
  think?: boolean;
  outputBudget?: ModelOutputBudget;
  numPredict?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ModelExecutionProgress) => void;
}

export interface ModelExecutionResult {
  provider: ModelProviderKind;
  modelId: string;
  text: string;
  finalContent?: string;
  thinkingStartedAt?: string;
  thinkingEndedAt?: string;
  finalStartedAt?: string;
  elapsedThinkingSeconds?: number;
  thinkingTimeoutMs?: number;
  resolvedNumCtx?: number;
  think?: boolean;
  outputBudget?: ModelOutputBudget;
  numPredict?: number;
  doneReason?: string;
  truncated?: boolean;
  thinkingStalled?: boolean;
  thinkingStallReason?: string;
}

export interface ModelExecutionProgress {
  finalContent?: string;
  thinkingStartedAt?: string;
  thinkingEndedAt?: string;
  finalStartedAt?: string;
  elapsedThinkingSeconds?: number;
  thinkingTimeoutMs?: number;
  resolvedNumCtx?: number;
  think?: boolean;
  outputBudget?: ModelOutputBudget;
  numPredict?: number;
  doneReason?: string;
  truncated?: boolean;
  thinkingStalled?: boolean;
  thinkingStallReason?: string;
  done?: boolean;
  /** Live token count: estimated during streaming, replaced by authoritative value on completion. */
  thinkingTokenCount?: number;
}

export class ModelProviderError extends Error {
  provider: ModelProviderKind;
  code:
    | "provider_unavailable"
    | "runtime_unavailable"
    | "model_missing"
    | "tags_unavailable"
    | "probe_timeout"
    | "stream_failed"
    | "unsafe_remote"
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
export const OLLAMA_LOCAL_PROVIDER_PROFILE_ID = "ollama-local";
export const OLLAMA_MAIN_DEFAULT_MODEL_ID = "qwen3.5:9b";
export const OLLAMA_QUICK_DEFAULT_MODEL_ID = OLLAMA_MAIN_DEFAULT_MODEL_ID;
const OLLAMA_MODEL_EXECUTION_TIMEOUT_MS = 300000;
const OLLAMA_PREFLIGHT_VERSION_TIMEOUT_MS = 3500;
const OLLAMA_PREFLIGHT_TAGS_TIMEOUT_MS = 6000;
const OLLAMA_MINIMUM_RECOMMENDED_VERSION = "0.17.1";

const suggestedOllamaModels: ModelDescriptor[] = [
  { id: OLLAMA_MAIN_DEFAULT_MODEL_ID, name: "Qwen 3.5 9B", provider: "ollama", installed: false },
  { id: "llama3.2", name: "Llama 3.2 3B", provider: "ollama", installed: false },
  { id: "codeqwen:7b-code", name: "CodeQwen 7B Code", provider: "ollama", installed: false },
  { id: "qwen:7b", name: "Qwen 7B", provider: "ollama", installed: false },
  { id: "llama3.1:8b", name: "Llama 3.1 8B", provider: "ollama", installed: false },
  { id: "qwen2.5:7b", name: "Qwen 2.5 7B", provider: "ollama", installed: false },
  { id: "mistral:7b", name: "Mistral 7B", provider: "ollama", installed: false },
  { id: "nomic-embed-text", name: "Nomic Embed Text", provider: "ollama", installed: false },
];

const mockModels: Record<ModelProfileId, ModelDescriptor> = {
  quick: {
    id: "mock-quick",
    name: "Demo Quick Response",
    provider: "mock",
    installed: true,
  },
  main: {
    id: "mock-main",
    name: "Demo Main Response",
    provider: "mock",
    installed: true,
  },
};

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
    quickModelId: OLLAMA_QUICK_DEFAULT_MODEL_ID,
    mainModelId: OLLAMA_MAIN_DEFAULT_MODEL_ID,
    mainProviderProfileId: OLLAMA_LOCAL_PROVIDER_PROFILE_ID,
    mainProviderDisplayName: "Ollama Local",
    mainProviderKind: "ollama",
  },
  demo: {
    mockResponsesEnabled: false,
  },
};

export function canUseMockResponseMode() {
  const hostname = globalThis.location?.hostname;
  return (
    import.meta.env.DEV ||
    import.meta.env.VITE_ENABLE_MOCK_RESPONSES === "true" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

export function isMockResponseModeEnabled(settings?: Pick<AIProviderSettings, "demo">) {
  return (
    canUseMockResponseMode() &&
    (import.meta.env.VITE_ENABLE_MOCK_RESPONSES === "true" ||
      Boolean(settings?.demo.mockResponsesEnabled))
  );
}

function profileDefaultModelId(profile: ModelProfileId) {
  return profile === "quick"
    ? OLLAMA_QUICK_DEFAULT_MODEL_ID
    : OLLAMA_MAIN_DEFAULT_MODEL_ID;
}

function normalizedMainProviderProfileId(settings: AIProviderSettings) {
  return settings.profiles.mainProviderProfileId || OLLAMA_LOCAL_PROVIDER_PROFILE_ID;
}

export function getMainProviderProfileId(settings: AIProviderSettings) {
  return normalizedMainProviderProfileId(settings);
}

export function isMainModelSelectionLocal(settings: AIProviderSettings) {
  return normalizedMainProviderProfileId(settings) === OLLAMA_LOCAL_PROVIDER_PROFILE_ID;
}

function resolveProfileModelId(
  selectedModelId: string | undefined,
  profile: ModelProfileId,
  models: ModelDescriptor[]
) {
  const selectedModel = selectedModelId
    ? models.find((model) => model.id === selectedModelId)
    : undefined;
  if (selectedModel?.installed) return selectedModel.id;

  const defaultModelId = profileDefaultModelId(profile);
  const defaultModel = models.find((model) => model.id === defaultModelId);
  if (defaultModel?.installed) return defaultModel.id;

  return selectedModelId || defaultModelId;
}

export function reconcileModelProfiles(settings: AIProviderSettings): AIProviderSettings {
  const quickModelId = resolveProfileModelId(
    settings.profiles.quickModelId,
    "quick",
    settings.ollama.models
  );
  const mainModelId = resolveProfileModelId(
    settings.profiles.mainModelId,
    "main",
    settings.ollama.models
  );
  if (
    quickModelId === settings.profiles.quickModelId &&
    mainModelId === settings.profiles.mainModelId
  ) {
    return settings;
  }
  return {
    ...settings,
    profiles: {
      ...settings.profiles,
      quickModelId,
      mainModelId,
    },
  };
}

function mergeSettings(value: Partial<AIProviderSettings>): AIProviderSettings {
  const merged = {
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
      mainProviderProfileId: value.profiles
        ? value.profiles.mainProviderProfileId
        : defaultAIProviderSettings.profiles.mainProviderProfileId,
      quickProviderProfileId: value.profiles
        ? value.profiles.quickProviderProfileId
        : defaultAIProviderSettings.profiles.quickProviderProfileId,
      mainProviderDisplayName: value.profiles
        ? value.profiles.mainProviderDisplayName
        : defaultAIProviderSettings.profiles.mainProviderDisplayName,
      mainProviderKind: value.profiles
        ? value.profiles.mainProviderKind
        : defaultAIProviderSettings.profiles.mainProviderKind,
    },
    demo: {
      ...defaultAIProviderSettings.demo,
      ...value.demo,
    },
  };
  return reconcileModelProfiles(merged);
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
  suggestedOllamaModels.forEach((model) =>
    byId.set(model.id, { ...model, name: displayNameForOllamaModel(model.id) })
  );
  models.forEach((model) => {
    const normalizedId = normalizeOllamaModelId(model.id);
    const current = byId.get(normalizedId);
    byId.set(normalizedId, {
      ...current,
      ...model,
      id: normalizedId,
      name: displayNameForOllamaModel(normalizedId),
      installed: Boolean(model.installed || current?.installed),
      size: model.size ?? current?.size,
      modifiedAt: model.modifiedAt ?? current?.modifiedAt,
      location: model.location ?? current?.location,
    });
  });
  return Array.from(byId.values());
}

export function normalizeOllamaModelId(modelId: string) {
  const trimmed = modelId.trim();
  const withoutLatest = trimmed.endsWith(":latest")
    ? trimmed.slice(0, -":latest".length)
    : trimmed;
  const displayNameAliases: Record<string, string> = {
    "qwen 3.5 9b": "qwen3.5:9b",
    "llama 3.2 3b": "llama3.2",
    "codeqwen 7b code": "codeqwen:7b-code",
    "qwen 7b": "qwen:7b",
    "llama 3.1 8b": "llama3.1:8b",
    "qwen 2.5 7b": "qwen2.5:7b",
    "mistral 7b": "mistral:7b",
    "nomic embed text": "nomic-embed-text",
  };
  return displayNameAliases[withoutLatest.toLowerCase()] ?? withoutLatest;
}

export function displayNameForOllamaModel(modelId: string) {
  const normalizedId = normalizeOllamaModelId(modelId).toLowerCase();
  const knownNames: Record<string, string> = {
    "qwen3.5:9b": "Qwen 3.5 9B",
    "llama3.2": "Llama 3.2 3B",
    "codeqwen:7b-code": "CodeQwen 7B Code",
    "qwen:7b": "Qwen 7B",
    "llama3.1:8b": "Llama 3.1 8B",
    "qwen2.5:7b": "Qwen 2.5 7B",
    "mistral:7b": "Mistral 7B",
    "nomic-embed-text": "Nomic Embed Text",
  };
  const knownName = knownNames[normalizedId];
  if (knownName) return knownName;
  return normalizedId
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => {
      const sizeMatch = part.match(/^(\d+(?:\.\d+)?)([bmk])$/i);
      if (sizeMatch) return `${sizeMatch[1]}${sizeMatch[2].toUpperCase()}`;
      if (/^qwen$/i.test(part)) return "Qwen";
      if (/^codeqwen$/i.test(part)) return "CodeQwen";
      if (/^llama\d*(?:\.\d+)?$/i.test(part)) {
        return part.replace(/^llama/i, "Llama ");
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isOllamaThinkingCandidate(modelId: string) {
  return /\bqwen/i.test(modelId);
}

export function resolveOllamaThinkValue(input: {
  modelId: string;
  mode: OllamaContextMode;
  promptText: string;
  referenceCount: number;
}) {
  if (input.mode === "instant") return false;
  if (!isOllamaThinkingCandidate(input.modelId)) return false;
  if (input.mode === "thinking") return true;
  return input.referenceCount >= 2 || input.promptText.length > 1200;
}

export interface OllamaContextLengthInput {
  promptText: string;
  referenceCount: number;
  referenceCharCount: number;
  messageCount: number;
  mode: OllamaContextMode;
  userConfiguredMaxContext: number;
}

export function resolveOllamaContextLength(input: OllamaContextLengthInput) {
  const userMax =
    Number.isFinite(input.userConfiguredMaxContext) && input.userConfiguredMaxContext > 0
      ? input.userConfiguredMaxContext
      : 2048;
  let resolved: number;

  if (
    input.referenceCount === 0 &&
    input.promptText.length < 1000 &&
    input.messageCount <= 2
  ) {
    resolved = 2048;
  } else if (input.referenceCount <= 2 && input.referenceCharCount < 6000) {
    resolved = 4096;
  } else if (input.referenceCount <= 6 && input.referenceCharCount < 16000) {
    resolved = 8192;
  } else {
    resolved = userMax;
  }

  if (input.mode === "instant" && input.referenceCount === 0 && input.promptText.length < 1000) {
    resolved = 2048;
  }

  return Math.min(resolved, userMax);
}

export function resolveThinkingTimeoutMs(input: {
  promptText: string;
  referenceCount: number;
  referenceCharCount: number;
  messageCount: number;
  resolvedNumCtx: number;
  mode: OllamaContextMode;
}) {
  let timeout = 90_000;
  if (
    input.promptText.length < 1000 &&
    input.referenceCount === 0 &&
    input.messageCount <= 2 &&
    input.resolvedNumCtx <= 2048
  ) {
    timeout = 15_000;
  } else if (
    input.referenceCount <= 2 &&
    input.referenceCharCount < 6000 &&
    input.resolvedNumCtx <= 4096
  ) {
    timeout = 30_000;
  } else if (input.referenceCount <= 6 && input.resolvedNumCtx <= 8192) {
    timeout = 60_000;
  }
  return Math.min(90_000, Math.max(12_000, timeout));
}

export function resolveOllamaNumPredict(input: {
  mode: OllamaContextMode;
  referenceCount: number;
  referenceCharCount: number;
  resolvedNumCtx: number;
  outputBudget?: ModelOutputBudget;
}) {
  if (input.outputBudget === "short") return input.mode === "thinking" ? 1024 : 768;
  if (input.outputBudget === "medium") return input.mode === "thinking" ? 1536 : 1024;
  if (input.outputBudget === "long") return 8192;
  if (input.outputBudget === "extended") return 16384;
  if (input.mode === "instant") return 512;
  if (input.mode === "thinking") {
    if (input.resolvedNumCtx > 8192) return 3072;
    if (input.resolvedNumCtx > 4096) return 2048;
    if (input.resolvedNumCtx > 2048) return 1536;
    return 1024;
  }
  if (input.referenceCount === 0) return 768;
  if (input.referenceCount <= 2 && input.referenceCharCount < 6000) return 1024;
  return 1536;
}

interface OllamaThinkingAccumulator {
  provider: ModelProviderKind;
  modelId: string;
  thinkingText: string;
  finalContent: string;
  thinkingStartedAt?: string;
  thinkingEndedAt?: string;
  finalStartedAt?: string;
  thinkingTimeoutMs?: number;
  resolvedNumCtx?: number;
  think?: boolean;
  outputBudget?: ModelOutputBudget;
  numPredict?: number;
  doneReason?: string;
  truncated?: boolean;
  thinkingStalled?: boolean;
  thinkingStallReason?: string;
}

interface OllamaStreamChunk {
  message?: {
    thinking?: string;
    content?: string;
  };
  thinking?: string;
  response?: string;
  done?: boolean;
  done_reason?: string;
  doneReason?: string;
  reason?: string;
  stop_reason?: string;
  stopReason?: string;
  error?: string;
}

function doneReasonFromChunk(chunk: OllamaStreamChunk) {
  return (
    chunk.done_reason ??
    chunk.doneReason ??
    chunk.stop_reason ??
    chunk.stopReason ??
    chunk.reason
  );
}

export function isLengthDoneReason(reason?: string) {
  return Boolean(reason && /length|num_predict|token|limit|max/i.test(reason));
}

function elapsedSeconds(start?: string, end?: string) {
  if (!start) return undefined;
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return undefined;
  return Math.max(0, (endMs - startMs) / 1000);
}

function applyOllamaChunk(
  state: OllamaThinkingAccumulator,
  thinkingChunk: string,
  finalChunk: string
) {
  if (thinkingChunk) {
    if (!state.thinkingStartedAt) state.thinkingStartedAt = new Date().toISOString();
    state.thinkingText += thinkingChunk;
  }
  if (finalChunk) {
    if (!state.finalStartedAt) {
      state.finalStartedAt = new Date().toISOString();
      if (state.thinkingStartedAt && !state.thinkingEndedAt) {
        state.thinkingEndedAt = state.finalStartedAt;
      }
    }
    state.finalContent += finalChunk;
  }
}

function resultFromOllamaState(state: OllamaThinkingAccumulator): ModelExecutionResult {
  if (state.thinkingStartedAt && !state.thinkingEndedAt) {
    state.thinkingEndedAt = new Date().toISOString();
  }
  const text = state.finalContent.trim() || "The model returned no final content.";
  return {
    provider: state.provider,
    modelId: state.modelId,
    text,
    finalContent: state.finalContent,
    thinkingStartedAt: state.thinkingStartedAt,
    thinkingEndedAt: state.thinkingEndedAt,
    finalStartedAt: state.finalStartedAt,
    elapsedThinkingSeconds: elapsedSeconds(state.thinkingStartedAt, state.thinkingEndedAt),
    thinkingTimeoutMs: state.thinkingTimeoutMs,
    resolvedNumCtx: state.resolvedNumCtx,
    think: state.think,
    outputBudget: state.outputBudget,
    numPredict: state.numPredict,
    doneReason: state.doneReason,
    truncated: state.truncated,
    thinkingStalled: state.thinkingStalled,
    thinkingStallReason: state.thinkingStallReason,
  };
}

function emitOllamaProgress(
  request: ModelExecutionRequest,
  state: OllamaThinkingAccumulator,
  done = false
) {
  request.onProgress?.({
    finalContent: state.finalContent,
    thinkingStartedAt: state.thinkingStartedAt,
    thinkingEndedAt: state.thinkingEndedAt,
    finalStartedAt: state.finalStartedAt,
    elapsedThinkingSeconds: elapsedSeconds(state.thinkingStartedAt, state.thinkingEndedAt),
    thinkingTimeoutMs: state.thinkingTimeoutMs,
    resolvedNumCtx: state.resolvedNumCtx,
    think: state.think,
    outputBudget: state.outputBudget,
    numPredict: state.numPredict,
    doneReason: state.doneReason,
    truncated: state.truncated,
    thinkingStalled: state.thinkingStalled,
    thinkingStallReason: state.thinkingStallReason,
    done,
  });
}

export function getInstalledModels(settings: AIProviderSettings) {
  return settings.ollama.models.filter((model) => model.installed);
}

export type ModelPickerInstalledState =
  | "live"
  | "scanning"
  | "cached"
  | "offline-empty"
  | "unknown-empty";

export function computeModelPickerInstalledState(input: {
  isMockProvider: boolean;
  isScanningModels: boolean;
  providerStatus: "unknown" | "connected" | "offline";
  installedCount: number;
}): ModelPickerInstalledState {
  if (input.isMockProvider) return "live";
  if (input.isScanningModels) return "scanning";
  if (input.providerStatus === "connected") return "live";
  if (input.installedCount > 0) return "cached";
  if (input.providerStatus === "offline") return "offline-empty";
  return "unknown-empty";
}

export function modelPickerStatusText(
  state: ModelPickerInstalledState,
  selectableCount: number
): string | null {
  if (state === "scanning") return "Scanning local Ollama models…";
  if (state === "cached") return "Ollama is offline. Showing last discovered local models.";
  if (state === "offline-empty") return "Ollama is not available.";
  if (state === "unknown-empty") return "Test Ollama to discover installed local models.";
  if (selectableCount === 0) return "No local models installed.";
  return null;
}

// ── Composer generation-state helpers ─────────────────────────────────────────

export interface ComposerRunState {
  running: boolean;
  message: string | null;
  blockedByOtherGeneration: boolean;
}

/**
 * Pure function: derive per-composer runtime state from global generation state.
 * The `targetKey` is the Loom/draft whose generation is currently active.
 * A non-target composer that sees `globalRunning=true` is blocked.
 */
export function computeComposerRunState(
  draftKey: string,
  targetKey: string | null,
  globalState: { running: boolean; message: string | null }
): ComposerRunState {
  const isTarget = targetKey === draftKey;
  if (isTarget) return { ...globalState, blockedByOtherGeneration: false };
  if (globalState.running) {
    return {
      running: false,
      message: "Another response is generating.",
      blockedByOtherGeneration: true,
    };
  }
  return { running: false, message: null, blockedByOtherGeneration: false };
}

/**
 * Pure function: determine why Quick Ask submit should be blocked, if at all.
 * Returns a human-readable reason string or null when not blocked.
 */
export function computeQuickAskBlockedReason(
  mainRunning: boolean,
  quickModelId: string,
  mainModelId: string
): string | null {
  if (!mainRunning) return null;
  if (quickModelId === mainModelId) {
    return "Quick Ask uses the same model currently generating";
  }
  return null;
}

export function getProfileModel(settings: AIProviderSettings, profile: ModelProfileId) {
  if (isMockResponseModeEnabled(settings)) return mockModels[profile];
  const modelId =
    profile === "quick"
      ? settings.profiles.quickModelId
      : settings.profiles.mainModelId;
  if (profile === "main" && !isMainModelSelectionLocal(settings)) {
    const displayName =
      settings.profiles.mainProviderDisplayName ??
      settings.profiles.mainProviderProfileId ??
      "Remote provider";
    return {
      id: modelId,
      name: `${displayName} · ${modelId}`,
      provider: settings.profiles.mainProviderKind ?? "openai-compatible",
      installed: true,
      location: displayName,
    };
  }
  return (
    settings.ollama.models.find((model) => model.id === modelId) ?? {
      id: modelId,
      name: modelId,
      provider: settings.activeProvider,
      installed: false,
    }
  );
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

export function validateOllamaBaseUrlSecurity(baseUrl: string) {
  try {
    const parsed = new URL(normalizeBaseUrl(baseUrl));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        allowed: false,
        localOnly: true,
        networkExposureRisk: "unknown" as const,
        warning: "Ollama base URL must use http or https.",
      };
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return {
        allowed: true,
        localOnly: true,
        networkExposureRisk: "low" as const,
        warning: "Ollama is local-only.",
      };
    }
    if (host === "0.0.0.0" || host === "::") {
      return {
        allowed: false,
        localOnly: true,
        networkExposureRisk: "high" as const,
        warning: "0.0.0.0 is not a safe Ollama client target.",
      };
    }
    return {
      allowed: false,
      localOnly: false,
      networkExposureRisk: "high" as const,
      warning: "Remote Ollama URL is not allowed by default.",
    };
  } catch {
    return {
      allowed: false,
      localOnly: true,
      networkExposureRisk: "unknown" as const,
      warning: "Ollama base URL is invalid.",
    };
  }
}

export function ollamaVersionSecurityStatus(version?: string) {
  if (!version) return "unavailable" as const;
  const comparison = compareVersionTriplet(version, OLLAMA_MINIMUM_RECOMMENDED_VERSION);
  if (comparison === undefined) return "unknown" as const;
  return comparison < 0 ? "vulnerable" as const : "ok" as const;
}

function compareVersionTriplet(left: string, right: string) {
  const leftParts = parseVersionTriplet(left);
  const rightParts = parseVersionTriplet(right);
  if (!leftParts || !rightParts) return undefined;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function parseVersionTriplet(value: string) {
  const [version] = value.trim().replace(/^v/i, "").split(/[-+]/);
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 1 || parts.some((part) => Number.isNaN(part))) return undefined;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0] as const;
}

function assertSafeOllamaBaseUrl(baseUrl: string) {
  const security = validateOllamaBaseUrlSecurity(baseUrl);
  if (!security.allowed) {
    throw new ModelProviderError("ollama", "unsafe_remote", security.warning);
  }
  return security;
}

function effortOptions(effort: ModelEffort | undefined) {
  if (effort === "Low") return { temperature: 0.2 };
  if (effort === "High") return { temperature: 0.45 };
  return { temperature: 0.3 };
}

function providerUnavailableMessage(baseUrl: string) {
  return `Local model provider is offline at ${baseUrl}. Loom is running normally. Start or install Ollama, then retry the connection.`;
}

export function mapOllamaError(error: unknown): RuntimeHealthStatus {
  if (error instanceof ModelProviderError && error.code === "unsafe_remote") return "degraded";
  if (error instanceof DOMException && error.name === "AbortError") return "degraded";
  if (error instanceof TypeError) return "not_running";
  if (error instanceof Error && /ECONNREFUSED|Failed to fetch|NetworkError/i.test(error.message)) {
    return "not_running";
  }
  return "degraded";
}

function ollamaErrorKind(error: unknown): OllamaRuntimeErrorKind {
  if (error instanceof ModelProviderError && error.code === "unsafe_remote") return "unsafe_remote";
  if (error instanceof DOMException && error.name === "AbortError") return "probe_timeout";
  if (error instanceof TypeError) return "runtime_unavailable";
  if (error instanceof Error && /ECONNREFUSED|Failed to fetch|NetworkError/i.test(error.message)) {
    return "runtime_unavailable";
  }
  return "unknown";
}

export function runtimeHealthMessage(status: RuntimeHealthStatus, baseUrl: string) {
  if (status === "ready") return "Local model provider is connected.";
  if (status === "not_running") {
    return `Local model provider is offline at ${baseUrl}. Loom is running normally. Start or install Ollama to use local models.`;
  }
  if (status === "degraded") return "Last connection attempt failed or returned an unexpected response.";
  return "Connection not tested yet.";
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8000
) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  if (externalSignal?.aborted) controller.abort();
  const abortFromExternalSignal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

export async function preflightOllamaRuntime(
  settings: AIProviderSettings,
  selectedModelId: string,
  signal?: AbortSignal
): Promise<OllamaRuntimeHealth> {
  const baseUrl = normalizeBaseUrl(settings.ollama.baseUrl);
  const baseUrlSecurity = assertSafeOllamaBaseUrl(baseUrl);
  const lastCheckedAt = new Date().toISOString();
  let version: string | undefined;

  try {
    const versionResponse = await fetchWithTimeout(
      `${baseUrl}/api/version`,
      { signal },
      OLLAMA_PREFLIGHT_VERSION_TIMEOUT_MS
    );
    if (!versionResponse.ok) {
      throw new ModelProviderError(
        "ollama",
        "runtime_unavailable",
        providerUnavailableMessage(baseUrl)
      );
    }
    const versionData = (await versionResponse.json().catch(() => ({}))) as { version?: string };
    version = versionData.version;
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    const kind = ollamaErrorKind(error);
    throw new ModelProviderError(
      "ollama",
      kind === "probe_timeout" ? "probe_timeout" : "runtime_unavailable",
      providerUnavailableMessage(baseUrl)
    );
  }

  let models: ModelDescriptor[];
  try {
    const tagsResponse = await fetchWithTimeout(
      `${baseUrl}/api/tags`,
      { signal },
      OLLAMA_PREFLIGHT_TAGS_TIMEOUT_MS
    );
    if (!tagsResponse.ok) {
      throw new ModelProviderError(
        "ollama",
        "tags_unavailable",
        `Ollama is reachable, but model tags are unavailable (${tagsResponse.status}). Open AI Providers and test the runtime.`
      );
    }
    const tags = (await tagsResponse.json()) as {
      models?: Array<{ name: string; size?: number; modified_at?: string }>;
    };
    models =
      tags.models?.map((model) => {
        const normalizedName = normalizeOllamaModelId(model.name);
        return {
          id: normalizedName,
          name: displayNameForOllamaModel(normalizedName),
          provider: "ollama" as const,
          installed: true,
          size: model.size ? formatBytes(model.size) : undefined,
          modifiedAt: model.modified_at,
          location: settings.ollama.modelLocation,
        };
      }) ?? [];
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    throw new ModelProviderError(
      "ollama",
      "tags_unavailable",
      "Ollama is reachable, but installed models could not be listed. Open AI Providers and test the runtime."
    );
  }

  const availableModels = models.map((model) => model.id);
  const selectedModelAvailable = availableModels.includes(normalizeOllamaModelId(selectedModelId));
  if (!selectedModelAvailable) {
    throw new ModelProviderError(
      "ollama",
      "model_missing",
      `${selectedModelId} is not installed. Pull it from AI Providers, then try again.`
    );
  }

  return {
    runtimeReachable: true,
    version,
    tagsReachable: true,
    availableModels,
    selectedModelAvailable,
    lastCheckedAt,
    stale: false,
    security: {
      localOnly: baseUrlSecurity.localOnly,
      networkExposureRisk: baseUrlSecurity.networkExposureRisk,
      versionStatus: ollamaVersionSecurityStatus(version),
      warnings:
        ollamaVersionSecurityStatus(version) === "vulnerable"
          ? ["Ollama version may be vulnerable. Update to 0.17.1 or newer."]
          : [baseUrlSecurity.warning],
    },
  };
}

export class OllamaProvider implements ModelProvider {
  kind: ModelProviderKind = "ollama";
  label = "Ollama";

  async testConnection(settings: AIProviderSettings) {
    const baseUrl = normalizeBaseUrl(settings.ollama.baseUrl);
    assertSafeOllamaBaseUrl(baseUrl);
    const response = await fetchWithTimeout(`${baseUrl}/api/version`);
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    return true;
  }

  async refreshModels(settings: AIProviderSettings) {
    const baseUrl = normalizeBaseUrl(settings.ollama.baseUrl);
    assertSafeOllamaBaseUrl(baseUrl);
    const response = await fetchWithTimeout(`${baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = (await response.json()) as {
      models?: Array<{
        name: string;
        size?: number;
        modified_at?: string;
      }>;
    };
    const installed =
      data.models?.map((model) => {
        const normalizedName = normalizeOllamaModelId(model.name);
        return {
          id: normalizedName,
          name: displayNameForOllamaModel(normalizedName),
          provider: "ollama" as const,
          installed: true,
          size: model.size ? formatBytes(model.size) : undefined,
          modifiedAt: model.modified_at,
          location: settings.ollama.modelLocation,
        };
      }) ?? [];
    return mergeOllamaModels(installed);
  }

  async pullModel(settings: AIProviderSettings, modelId: string) {
    void settings;
    void modelId;
    throw new ModelProviderError(
      "ollama",
      "provider_not_implemented",
      "Model downloads are owned by loom-service runtime manager."
    );
  }

  async execute(settings: AIProviderSettings, request: ModelExecutionRequest) {
    const baseUrl = normalizeBaseUrl(settings.ollama.baseUrl);
    await preflightOllamaRuntime(settings, request.modelId, request.signal);
    const contextCharCount =
      request.context?.reduce((total, content) => total + content.length, 0) ?? 0;
    const referenceCount = request.referenceCount ?? request.context?.length ?? 0;
    const referenceCharCount = request.referenceCharCount ?? contextCharCount;
    const messageCount =
      request.messageCount ?? (request.system ? 1 : 0) + (request.context?.length ?? 0) + 1;
    const mode = request.mode ?? "auto";
    const think =
      request.think ??
      resolveOllamaThinkValue({
        modelId: request.modelId,
        mode,
        promptText: request.prompt,
        referenceCount,
      });
    const resolvedContextLength = resolveOllamaContextLength({
      promptText: request.prompt,
      referenceCount,
      referenceCharCount,
      messageCount,
      mode,
      userConfiguredMaxContext: settings.ollama.contextLength,
    });
    const thinkingTimeoutMs = resolveThinkingTimeoutMs({
      promptText: request.prompt,
      referenceCount,
      referenceCharCount,
      messageCount,
      resolvedNumCtx: resolvedContextLength,
      mode,
    });
    const numPredict =
      request.numPredict ??
      resolveOllamaNumPredict({
        mode,
        referenceCount,
        referenceCharCount,
        resolvedNumCtx: resolvedContextLength,
        outputBudget: request.outputBudget,
      });
    const options = {
      ...effortOptions(request.effort),
      num_ctx: resolvedContextLength,
      num_predict: numPredict,
    };
    const state: OllamaThinkingAccumulator = {
      provider: this.kind,
      modelId: request.modelId,
      thinkingText: "",
      finalContent: "",
      thinkingTimeoutMs,
      resolvedNumCtx: resolvedContextLength,
      think,
      outputBudget: request.outputBudget,
      numPredict,
    };

    const readStream = async (
      response: Response,
      selectChunks: (chunk: OllamaStreamChunk) => { thinking: string; content: string }
    ) => {
      const reader = response.body?.getReader();
      if (!reader) return false;
      const decoder = new TextDecoder();
      let buffer = "";
      const thinkingChunks: string[] = [];

      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let chunk: OllamaStreamChunk;
        try {
          chunk = JSON.parse(trimmed) as OllamaStreamChunk;
        } catch {
          throw new ModelProviderError(
            "ollama",
            "stream_failed",
            "Ollama started responding, but the stream returned invalid data. Retry after testing the runtime."
          );
        }
        if (chunk.error) {
          throw new ModelProviderError("ollama", "request_failed", chunk.error);
        }
        const doneReason = doneReasonFromChunk(chunk);
        if (doneReason) {
          state.doneReason = doneReason;
        }
        const selected = selectChunks(chunk);
        applyOllamaChunk(state, selected.thinking, selected.content);
        if (selected.thinking) {
          thinkingChunks.push(selected.thinking);
          const startedAt = state.thinkingStartedAt ? Date.parse(state.thinkingStartedAt) : Date.now();
          const detection = detectThinkingLoop({
            recentThinkingText: state.thinkingText.slice(-6000),
            previousChunks: thinkingChunks,
            elapsedMs: Math.max(0, Date.now() - startedAt),
            finalContentStarted: Boolean(state.finalStartedAt),
          });
          if (detection.isLooping && !state.thinkingStalled) {
            state.thinkingStalled = true;
            state.thinkingStallReason = detection.reason;
          }
        }
        if (chunk.done && isLengthDoneReason(state.doneReason)) {
          state.truncated = true;
        }
        if (selected.thinking || selected.content || chunk.done) {
          emitOllamaProgress(request, state, Boolean(chunk.done));
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consumeLine);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consumeLine(buffer);
      return true;
    };

    try {
      let chatResponse = await fetchWithTimeout(
        `${baseUrl}/api/chat`,
        {
          method: "POST",
          signal: request.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: request.modelId,
            stream: true,
            think,
            options,
            messages: [
              ...(request.system ? [{ role: "system", content: request.system }] : []),
              ...(request.context?.map((content) => ({ role: "user", content })) ?? []),
              { role: "user", content: request.prompt },
            ],
          }),
        },
        OLLAMA_MODEL_EXECUTION_TIMEOUT_MS
      );

      if (!chatResponse.ok && think && chatResponse.status === 400) {
        chatResponse = await fetchWithTimeout(
          `${baseUrl}/api/chat`,
          {
            method: "POST",
            signal: request.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: request.modelId,
              stream: true,
              options,
              messages: [
                ...(request.system ? [{ role: "system", content: request.system }] : []),
                ...(request.context?.map((content) => ({ role: "user", content })) ?? []),
                { role: "user", content: request.prompt },
              ],
            }),
          },
          OLLAMA_MODEL_EXECUTION_TIMEOUT_MS
        );
      }

      if (chatResponse.ok) {
        const streamed = await readStream(chatResponse, (chunk) => ({
          thinking: chunk.message?.thinking ?? "",
          content: chunk.message?.content ?? "",
        }));
        if (streamed) return resultFromOllamaState(state);

        const data = (await chatResponse.json()) as {
          message?: { content?: string; thinking?: string };
          done_reason?: string;
          doneReason?: string;
          reason?: string;
          stop_reason?: string;
          stopReason?: string;
        };
        state.doneReason = doneReasonFromChunk(data);
        state.truncated = isLengthDoneReason(state.doneReason);
        applyOllamaChunk(state, data.message?.thinking ?? "", data.message?.content ?? "");
        emitOllamaProgress(request, state, true);
        return resultFromOllamaState(state);
      }

      if (chatResponse.status === 404) {
        throw new ModelProviderError(
          "ollama",
          "model_missing",
          `${request.modelId} is not installed. Pull it from AI Providers, then try again.`
        );
      }

      let generateResponse = await fetchWithTimeout(
        `${baseUrl}/api/generate`,
        {
          method: "POST",
          signal: request.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: request.modelId,
            stream: true,
            think,
            prompt: [request.system, ...(request.context ?? []), request.prompt]
              .filter(Boolean)
              .join("\n\n"),
            options,
          }),
        },
        OLLAMA_MODEL_EXECUTION_TIMEOUT_MS
      );

      if (!generateResponse.ok && think && generateResponse.status === 400) {
        generateResponse = await fetchWithTimeout(
          `${baseUrl}/api/generate`,
          {
            method: "POST",
            signal: request.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: request.modelId,
              stream: true,
              prompt: [request.system, ...(request.context ?? []), request.prompt]
                .filter(Boolean)
                .join("\n\n"),
              options,
            }),
          },
          OLLAMA_MODEL_EXECUTION_TIMEOUT_MS
        );
      }

      if (generateResponse.status === 404) {
        throw new ModelProviderError(
          "ollama",
          "model_missing",
          `${request.modelId} is not installed. Pull it from AI Providers, then try again.`
        );
      }

      if (!generateResponse.ok) {
        throw new ModelProviderError(
          "ollama",
          "request_failed",
          `Ollama returned ${generateResponse.status}.`
        );
      }

      const streamed = await readStream(generateResponse, (chunk) => ({
        thinking: chunk.thinking ?? "",
        content: chunk.response ?? "",
      }));
      if (streamed) return resultFromOllamaState(state);

      const data = (await generateResponse.json()) as {
        response?: string;
        thinking?: string;
        done_reason?: string;
        doneReason?: string;
        reason?: string;
        stop_reason?: string;
        stopReason?: string;
      };
      state.doneReason = doneReasonFromChunk(data);
      state.truncated = isLengthDoneReason(state.doneReason);
      applyOllamaChunk(state, data.thinking ?? "", data.response ?? "");
      emitOllamaProgress(request, state, true);
      return resultFromOllamaState(state);
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      const mapped = mapOllamaError(error);
      throw new ModelProviderError(
        "ollama",
        mapped === "degraded" ? "request_failed" : "runtime_unavailable",
        mapped === "degraded"
          ? "Ollama runtime timed out or returned an unexpected response."
          : providerUnavailableMessage(baseUrl)
      );
    }
  }
}

export class MockModelProvider implements ModelProvider {
  kind: ModelProviderKind = "mock";
  label = "Demo Response";

  async testConnection() {
    return true;
  }

  async refreshModels() {
    return Object.values(mockModels);
  }

  async pullModel() {
    return undefined;
  }

  async execute(_settings: AIProviderSettings, request: ModelExecutionRequest) {
    const text =
      request.profile === "quick"
        ? this.quickResponse(request)
        : this.mainResponse(request);
    return {
      provider: this.kind,
      modelId: request.modelId,
      text,
    };
  }

  private quickResponse(request: ModelExecutionRequest) {
    const selectedFragment = request.context?.find((item) =>
      item.includes("Selected fragment:")
    );
    const currentQuestion = request.context
      ?.find((item) => item.includes("User question:") || item.includes("Current question:"))
      ?.match(/(?:User question|Current question):\s*"([^"]+)"/)?.[1]?.trim() ?? request.prompt.trim();
    const detectedIntent = request.context
      ?.find((item) => item.includes("Detected intent:"))
      ?.match(/Detected intent:\s*([a-z_]+)/)?.[1]?.trim();
    const sourceContext = request.context?.find((item) =>
      item.startsWith("Source context:") ||
      item.startsWith("Background source context, use only if needed:")
    );
    const allContextText = request.context?.join("\n\n") ?? "";
    const sourceTitle = sourceContext?.match(/Title:\s*([^\n]+)/)?.[1]?.trim();
    const hasPreviousQuickTurns = Boolean(
      request.context?.some((item) => item.startsWith("Previous quick turns:"))
    );
    const usedFullSource = Boolean(
      request.context?.some((item) => item.startsWith("Source text:"))
    );
    const selectedFragmentText = selectedFragment
      ?.match(/Selected fragment:\s*"([^"]+)"/)?.[1]
      ?.trim();
    const acronymExpansions: Record<string, string> = {
      API: "Application Programming Interface",
      CQRS: "Command Query Responsibility Segregation",
      HTTP: "Hypertext Transfer Protocol",
      IPC: "Inter-Process Communication",
      JWT: "JSON Web Token",
      MCP: "Model Context Protocol",
    };
    const selectedAcronym = selectedFragmentText?.toUpperCase();
    const expansion = selectedAcronym ? acronymExpansions[selectedAcronym] : undefined;
    if (detectedIntent === "acronym_expansion" && selectedAcronym && expansion) {
      const sourceAware =
        selectedAcronym === "MCP" &&
        /\b(plugin|plugins|tool|tools|session|server|capability|capabilities)\b/i.test(allContextText);
      return [
        "Demo quick answer:",
        `${selectedAcronym} = ${expansion}.`,
        sourceAware
          ? "Bu context'te MCP, plugin entegrasyonu ve araç/session akışıyla ilişkili Model Context Protocol anlamında kullanılıyor."
          : "This answers the current question about the selected fragment, not the broader source response.",
        sourceAware
          ? "Seçili parçada açılım açıkça yazmıyorsa bunu context'e göre muhtemel anlam olarak okumak gerekir."
          : "",
        hasPreviousQuickTurns ? "It includes previous quick turns." : "",
        usedFullSource ? "Full source text was sent." : "Full source text was not sent.",
      ].filter(Boolean).join("\n\n");
    }
    if (detectedIntent === "acronym_expansion" && selectedAcronym && !expansion) {
      return [
        "Demo quick answer:",
        `${selectedAcronym} için seçili metinde ya da kaynak context'te açık bir açılım görünmüyor.`,
        "Bu yüzden kesin bir açılım uydurmak yerine kaynak metindeki kullanım bağlamına göre yorumlamak gerekir.",
        hasPreviousQuickTurns ? "It includes previous quick turns." : "",
      ].filter(Boolean).join("\n\n");
    }
    if (hasPreviousQuickTurns && selectedFragmentText) {
      return [
        "Demo quick answer:",
        `This uses the selected fragment ${selectedFragmentText}.`,
        "It includes previous quick turns and uses the current follow-up first.",
        "It stays concise, but it is not forced into a single line.",
      ].join("\n\n");
    }
    return [
      "Demo quick answer:",
      selectedFragmentText
        ? `This uses the selected fragment ${selectedFragmentText}.`
        : sourceTitle
          ? `This stays anchored to ${sourceTitle}.`
          : "This stays anchored to the selected Loom context.",
      hasPreviousQuickTurns ? "It includes previous quick turns." : "",
      usedFullSource ? "Full source text was sent." : "Full source text was not sent.",
      "Use this to validate the Quick Question flow without a live model.",
    ].filter(Boolean).join("\n\n");
  }

  private mainResponse(request: ModelExecutionRequest) {
    const prompt = request.prompt.trim();
    const referenceCount = request.context?.length ?? 0;
    return [
      "Demo response generated by the mock provider.",
      "",
      prompt
        ? `It received the prompt: \"${prompt.slice(0, 140)}${prompt.length > 140 ? "..." : ""}\".`
        : "It received an empty prompt and continued from the attached Loom references.",
      "",
      "- This deterministic response exercises the same append-message path as a real provider.",
      `- Attached Loom references visible to the provider: ${referenceCount}.`,
      "- Replace this by disabling demo responses and using a configured runtime.",
    ].join("\n");
  }
}

class FutureProvider implements ModelProvider {
  constructor(
    readonly kind: Exclude<ModelProviderKind, "ollama" | "mock">,
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
  if (kind === "mock") return new MockModelProvider();
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
