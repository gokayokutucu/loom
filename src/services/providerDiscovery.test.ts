import { describe, expect, it } from "vitest";
import type { RuntimeModelProviderStatus, RuntimeModelItem } from "../engine";
import { normalizeRuntimeProvider } from "./providerDiscovery";

function mockProviderStatus(
  overrides: Partial<RuntimeModelProviderStatus> = {}
): RuntimeModelProviderStatus {
  return {
    providerKind: "openai_compatible",
    providerProfileId: "some-provider",
    displayName: "Some Provider",
    transportKind: "native_openai_compatible",
    vendor: "custom",
    enabled: true,
    experimental: false,
    requiresSecret: true,
    secretStatus: "saved",
    runtimeStatus: "ready",
    status: "ready",
    baseUrl: "https://api.someprovider.com/v1",
    defaultModel: "model-a",
    runtimeOwnedBy: "loom-service",
    supportsDownloads: false,
    supportsStart: false,
    supportsStop: false,
    warnings: [],
    ...overrides,
  };
}

function mockModelItem(
  overrides: Partial<RuntimeModelItem> = {}
): RuntimeModelItem {
  return {
    assetId: "model-asset-1",
    providerKind: "openai_compatible",
    providerProfileId: "some-provider",
    modelName: "model-a",
    displayName: "Model A",
    installed: true,
    status: "available",
    supportsQuick: true,
    supportsMain: true,
    supportsThinking: false,
    source: "discovered",
    ...overrides,
  };
}

describe("normalizeRuntimeProvider", () => {
  it("correctly normalizes default Ollama provider", () => {
    const status = mockProviderStatus({
      providerKind: "ollama",
      providerProfileId: "ollama-local",
      displayName: "Ollama Local",
      baseUrl: "http://127.0.0.1:11434",
      defaultModel: "qwen3.5:9b",
    });

    const normalized = normalizeRuntimeProvider(status);

    expect(normalized).toEqual({
      id: "ollama-local",
      label: "Ollama Local",
      kind: "ollama",
      endpoint: "http://127.0.0.1:11434",
      modelIds: ["qwen3.5:9b"],
      isDefault: true,
      isSandbox: false,
      isAvailable: true,
      warning: undefined,
    });
  });

  it("correctly normalizes litellm-sandbox provider", () => {
    const status = mockProviderStatus({
      providerKind: "openai_compatible",
      providerProfileId: "litellm-sandbox",
      displayName: "LiteLLM Sandbox",
      baseUrl: "http://127.0.0.1:4000/v1",
      defaultModel: "gpt-4o-mini",
    });

    const normalized = normalizeRuntimeProvider(status);

    expect(normalized).toEqual({
      id: "litellm-sandbox",
      label: "LiteLLM Sandbox",
      kind: "sandbox",
      endpoint: "http://127.0.0.1:4000/v1",
      modelIds: ["gpt-4o-mini"],
      isDefault: false,
      isSandbox: true,
      isAvailable: true,
      warning: undefined,
    });
  });

  it("correctly normalizes unknown or custom provider kinds", () => {
    const status = mockProviderStatus({
      providerKind: "custom_http_later",
      providerProfileId: "custom-gateway",
      displayName: "Custom Gateway",
      defaultModel: "custom-model",
    });

    const normalized = normalizeRuntimeProvider(status);

    expect(normalized.kind).toBe("custom");
    expect(normalized.isDefault).toBe(false);
    expect(normalized.isSandbox).toBe(false);

    const fallbackStatus = mockProviderStatus({
      providerKind: "something_completely_unknown",
      providerProfileId: "mystery-provider",
    });
    const normalizedFallback = normalizeRuntimeProvider(fallbackStatus);
    expect(normalizedFallback.kind).toBe("unknown");
  });

  it("sets isAvailable correctly based on status field", () => {
    const readyStatus = mockProviderStatus({ status: "ready" });
    expect(normalizeRuntimeProvider(readyStatus).isAvailable).toBe(true);

    const offlineStatus = mockProviderStatus({ status: "offline" });
    expect(normalizeRuntimeProvider(offlineStatus).isAvailable).toBe(false);

    const disabledStatus = mockProviderStatus({ status: "disabled" });
    expect(normalizeRuntimeProvider(disabledStatus).isAvailable).toBe(false);
  });

  it("collects warning messages from provider status warnings list", () => {
    const status = mockProviderStatus({
      warnings: ["First warning", "Second warning"],
    });

    const normalized = normalizeRuntimeProvider(status);
    expect(normalized.warning).toBe("First warning Second warning");
  });

  it("associates modelIds from the provided models list when providerProfileId matches", () => {
    const status = mockProviderStatus({
      providerProfileId: "nvidia",
      defaultModel: "nvidia/llama-3",
    });

    const models: RuntimeModelItem[] = [
      mockModelItem({ providerProfileId: "nvidia", modelName: "nvidia/llama-3" }),
      mockModelItem({ providerProfileId: "nvidia", modelName: "nvidia/mixtral" }),
      mockModelItem({ providerProfileId: "ollama-local", modelName: "qwen" }),
    ];

    const normalized = normalizeRuntimeProvider(status, models);
    expect(normalized.modelIds).toEqual(["nvidia/llama-3", "nvidia/mixtral"]);
  });

  it("falls back to defaultModel when no models match or are provided", () => {
    const status = mockProviderStatus({
      providerProfileId: "nvidia",
      defaultModel: "nvidia/llama-3",
    });

    const models: RuntimeModelItem[] = [
      mockModelItem({ providerProfileId: "ollama-local", modelName: "qwen" }),
    ];

    const normalizedWithMismatchedModels = normalizeRuntimeProvider(status, models);
    expect(normalizedWithMismatchedModels.modelIds).toEqual(["nvidia/llama-3"]);

    const normalizedWithoutModels = normalizeRuntimeProvider(status);
    expect(normalizedWithoutModels.modelIds).toEqual(["nvidia/llama-3"]);
  });

  it("ensures no secrets or API keys are exposed", () => {
    const status = mockProviderStatus({
      providerProfileId: "nvidia",
    });

    const normalized = normalizeRuntimeProvider(status);

    // Assert secretStatus or requiresSecret are not copied to any fields
    expect(Object.keys(normalized)).not.toContain("secretStatus");
    expect(Object.keys(normalized)).not.toContain("requiresSecret");
    expect(Object.keys(normalized)).not.toContain("secretRef");
    expect(Object.keys(normalized)).not.toContain("apiKey");
  });
});
