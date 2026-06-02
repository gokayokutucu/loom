import { describe, expect, test } from "vitest";
import {
  defaultAIProviderSettings,
  getInstalledModels,
  getProfileModel,
  mergeOllamaModels,
  type AIProviderSettings,
} from "./modelProviders";

function settingsWithModels(models: AIProviderSettings["ollama"]["models"]): AIProviderSettings {
  return {
    ...defaultAIProviderSettings,
    ollama: {
      ...defaultAIProviderSettings.ollama,
      models,
    },
  };
}

describe("model provider installed model filtering", () => {
  test("static Ollama suggestions are not treated as installed models", () => {
    const settings = settingsWithModels(defaultAIProviderSettings.ollama.models);

    expect(getInstalledModels(settings)).toEqual([]);
  });

  test("live installed models are the only installed choices after merge", () => {
    const models = mergeOllamaModels([
      {
        id: "llama3.2:latest",
        name: "llama3.2:latest",
        provider: "ollama",
        installed: true,
      },
      {
        id: "qwen2.5:7b",
        name: "qwen2.5:7b",
        provider: "ollama",
        installed: true,
      },
    ]);
    const installed = getInstalledModels(settingsWithModels(models));

    expect(installed.map((model) => model.id)).toEqual(["llama3.2", "qwen2.5:7b"]);
    expect(installed.map((model) => model.name)).toEqual(["Llama 3.2 3B", "Qwen 2.5 7B"]);
  });

  test("persisted default model can be displayed but remains unavailable when not installed", () => {
    const settings = settingsWithModels(defaultAIProviderSettings.ollama.models);
    const mainModel = getProfileModel(settings, "main");

    expect(mainModel.name).toBe("Qwen 3.5 9B");
    expect(mainModel.installed).toBe(false);
    expect(getInstalledModels(settings).some((model) => model.id === mainModel.id)).toBe(false);
  });
});
