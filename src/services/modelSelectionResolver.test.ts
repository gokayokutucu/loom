import { describe, test, expect } from "vitest";
import { resolveModelSelection, restoreModelSelection } from "./modelSelectionResolver";
import type { ProviderProfile } from "./providerDiscovery";

describe("resolveModelSelection helper", () => {
  const availableProfiles: ProviderProfile[] = [
    {
      id: "ollama-local",
      label: "Ollama Local",
      kind: "ollama",
      modelIds: ["qwen:7b", "llama3.2", "mistral:7b"],
      isDefault: true,
      isAvailable: true,
    },
    {
      id: "litellm-sandbox",
      label: "LiteLLM Sandbox",
      kind: "sandbox",
      modelIds: ["llama3.2", "gpt-4o"],
      isSandbox: true,
      isAvailable: true,
    },
  ];

  test("legacy behavior: resolves successfully when only selectedModelId is provided and unique", () => {
    const result = resolveModelSelection({
      selectedModelId: "qwen:7b",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "ollama-local",
      modelId: "qwen:7b",
      requestModel: "qwen:7b",
      isAmbiguous: false,
      warning: undefined,
    });
  });

  test("legacy behavior: preserves current behavior if model is not declared in any profile", () => {
    const result = resolveModelSelection({
      selectedModelId: "unknown-model-id",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: undefined,
      modelId: "unknown-model-id",
      requestModel: "unknown-model-id",
      isAmbiguous: false,
      warning: undefined,
    });
  });

  test("selected provider + model resolves successfully when model exists", () => {
    const result = resolveModelSelection({
      selectedModelId: "qwen:7b",
      selectedProviderProfileId: "ollama-local",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "ollama-local",
      modelId: "qwen:7b",
      requestModel: "qwen:7b",
      isAmbiguous: false,
      warning: undefined,
    });
  });

  test("missing model under selected provider gives warning but does not fail", () => {
    const result = resolveModelSelection({
      selectedModelId: "gpt-4o",
      selectedProviderProfileId: "ollama-local",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "ollama-local",
      modelId: "gpt-4o",
      requestModel: "gpt-4o",
      isAmbiguous: false,
      warning: 'Model "gpt-4o" is not declared in provider profile "ollama-local".',
    });
  });

  test("same model under multiple provider profiles flags ambiguity when provider is not specified", () => {
    const result = resolveModelSelection({
      selectedModelId: "llama3.2",
      availableProfiles,
    });
    expect(result.isAmbiguous).toBe(true);
    expect(result.providerProfileId).toBeUndefined();
    expect(result.modelId).toBe("llama3.2");
    expect(result.requestModel).toBe("llama3.2");
    expect(result.warning).toContain("multiple provider profiles");
  });

  test("same model under multiple provider profiles resolves cleanly if provider profile is explicitly selected", () => {
    const result = resolveModelSelection({
      selectedModelId: "llama3.2",
      selectedProviderProfileId: "litellm-sandbox",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "litellm-sandbox",
      modelId: "llama3.2",
      requestModel: "llama3.2",
      isAmbiguous: false,
      warning: undefined,
    });
  });

  test("unknown provider fallback is safe and doesn't crash", () => {
    const result = resolveModelSelection({
      selectedModelId: "qwen:7b",
      selectedProviderProfileId: "unknown-provider-id",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: undefined,
      modelId: "qwen:7b",
      requestModel: "qwen:7b",
      isAmbiguous: false,
      warning: 'Selected provider profile "unknown-provider-id" was not found.',
    });
  });

  test("LiteLLM sandbox profile resolves without special casing outside providerDiscovery classification", () => {
    const result = resolveModelSelection({
      selectedModelId: "gpt-4o",
      selectedProviderProfileId: "litellm-sandbox",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "litellm-sandbox",
      modelId: "gpt-4o",
      requestModel: "gpt-4o",
      isAmbiguous: false,
      warning: undefined,
    });
  });
});

describe("restoreModelSelection helper", () => {
  const availableProfiles: ProviderProfile[] = [
    {
      id: "ollama-local",
      label: "Ollama Local",
      kind: "ollama",
      modelIds: ["qwen:7b", "llama3.2"],
      isDefault: true,
      isAvailable: true,
    },
    {
      id: "litellm-sandbox",
      label: "LiteLLM Sandbox",
      kind: "sandbox",
      modelIds: ["llama3.2", "gpt-4o-mini"],
      isSandbox: true,
      isAvailable: true,
    },
  ];

  test("exact restore when provider profile exists", () => {
    const result = restoreModelSelection({
      selectedModelId: "qwen:7b",
      selectedProviderProfileId: "ollama-local",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "ollama-local",
      modelId: "qwen:7b",
      requestModel: "qwen:7b",
      isAmbiguous: false,
      warning: undefined,
    });
  });

  test("legacy restore auto-resolves when provider profile is not specified", () => {
    const result = restoreModelSelection({
      selectedModelId: "gpt-4o-mini",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "litellm-sandbox",
      modelId: "gpt-4o-mini",
      requestModel: "gpt-4o-mini",
      isAmbiguous: false,
      warning: undefined,
    });
  });

  test("missing provider fallback when profile is specified but missing in available list", () => {
    const result = restoreModelSelection({
      selectedModelId: "gpt-4o-mini",
      selectedProviderProfileId: "missing-provider-id",
      availableProfiles,
    });
    // Fall back to resolving because provider profile is missing, resolves to litellm-sandbox where gpt-4o-mini is
    expect(result).toEqual({
      providerProfileId: "litellm-sandbox",
      modelId: "gpt-4o-mini",
      requestModel: "gpt-4o-mini",
      isAmbiguous: false,
      warning: undefined,
    });
  });

  test("duplicate model restore when provider profile is not specified flags ambiguity", () => {
    const result = restoreModelSelection({
      selectedModelId: "llama3.2",
      availableProfiles,
    });
    expect(result.isAmbiguous).toBe(true);
    expect(result.providerProfileId).toBeUndefined();
    expect(result.warning).toContain("ambiguous");
  });

  test("duplicate model restore preserves exact pair if provider profile is specified", () => {
    const result = restoreModelSelection({
      selectedModelId: "llama3.2",
      selectedProviderProfileId: "litellm-sandbox",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "litellm-sandbox",
      modelId: "llama3.2",
      requestModel: "llama3.2",
      isAmbiguous: false,
      warning: undefined,
    });
  });

  test("LiteLLM sandbox exact restore works correctly", () => {
    const result = restoreModelSelection({
      selectedModelId: "gpt-4o-mini",
      selectedProviderProfileId: "litellm-sandbox",
      availableProfiles,
    });
    expect(result).toEqual({
      providerProfileId: "litellm-sandbox",
      modelId: "gpt-4o-mini",
      requestModel: "gpt-4o-mini",
      isAmbiguous: false,
      warning: undefined,
    });
  });
});
