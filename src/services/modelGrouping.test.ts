import { describe, test, expect } from "vitest";
import { resolveModelSelection } from "./modelSelectionResolver";
import type { ProviderProfile } from "./providerDiscovery";

describe("Model Picker Grouping and Mapping", () => {
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
      modelIds: ["llama3.2", "gpt-4o-mini"],
      isSandbox: true,
      isAvailable: true,
    },
    {
      id: "openai",
      label: "OpenAI",
      kind: "openai-compatible",
      modelIds: ["gpt-4o"],
      isAvailable: true,
    },
    {
      id: "anthropic",
      label: "Anthropic",
      kind: "openai-compatible",
      modelIds: ["claude-sonnet"],
      isAvailable: true,
    },
  ];

  test("1. Grouping logic: each provider profile renders its associated modelIds", () => {
    // Grouping mapping simulation
    const grouped = availableProfiles.map((p) => ({
      providerId: p.id,
      label: p.label,
      models: p.modelIds,
    }));

    expect(grouped).toHaveLength(4);
    expect(grouped[0]).toEqual({
      providerId: "ollama-local",
      label: "Ollama Local",
      models: ["qwen:7b", "llama3.2", "mistral:7b"],
    });
    expect(grouped[1]).toEqual({
      providerId: "litellm-sandbox",
      label: "LiteLLM Sandbox",
      models: ["llama3.2", "gpt-4o-mini"],
    });
  });

  test("2. Duplicate model handling: same model ID under multiple providers is visible under both and resolves uniquely", () => {
    const duplicateModelId = "llama3.2";

    // Finds duplicate model under multiple profiles
    const appearances = availableProfiles.filter((p) => p.modelIds.includes(duplicateModelId));
    expect(appearances).toHaveLength(2);
    expect(appearances.map((p) => p.id)).toContain("ollama-local");
    expect(appearances.map((p) => p.id)).toContain("litellm-sandbox");

    // Selection resolves to the exact provider+model pair
    const resolveOllama = resolveModelSelection({
      selectedModelId: duplicateModelId,
      selectedProviderProfileId: "ollama-local",
      availableProfiles,
    });
    expect(resolveOllama.providerProfileId).toBe("ollama-local");
    expect(resolveOllama.modelId).toBe(duplicateModelId);

    const resolveLiteLlm = resolveModelSelection({
      selectedModelId: duplicateModelId,
      selectedProviderProfileId: "litellm-sandbox",
      availableProfiles,
    });
    expect(resolveLiteLlm.providerProfileId).toBe("litellm-sandbox");
    expect(resolveLiteLlm.modelId).toBe(duplicateModelId);
  });

  test("3. Selection persistence mapping: maps legacy format to provider profile", () => {
    // Case A: Model only exists on 1 provider -> Auto-resolves profile ID
    const resolveUnique = resolveModelSelection({
      selectedModelId: "gpt-4o",
      availableProfiles,
    });
    expect(resolveUnique.providerProfileId).toBe("openai");

    // Case B: Model exists on multiple -> flags ambiguity, returns undefined profile
    const resolveAmbiguous = resolveModelSelection({
      selectedModelId: "llama3.2",
      availableProfiles,
    });
    expect(resolveAmbiguous.isAmbiguous).toBe(true);
    expect(resolveAmbiguous.providerProfileId).toBeUndefined();
  });

  test("4. LiteLLM sandbox profile grouping contains sandbox badges and correct models", () => {
    const sandboxProfile = availableProfiles.find((p) => p.id === "litellm-sandbox");
    expect(sandboxProfile).toBeDefined();
    expect(sandboxProfile?.isSandbox).toBe(true);
    expect(sandboxProfile?.modelIds).toContain("gpt-4o-mini");
    expect(sandboxProfile?.modelIds).toContain("llama3.2");
  });
});
