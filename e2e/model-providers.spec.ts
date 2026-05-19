// E2E data authority classification: PURE_UI_HELPER.
// This spec validates local model metadata normalization without contacting provider runtimes.
import { expect, test } from "@playwright/test";
import {
  displayNameForOllamaModel,
  mergeOllamaModels,
} from "../src/services/modelProviders";

test.describe("[pure-helper] Model provider metadata", () => {
  test("Ollama model labels are human readable", () => {
    expect(displayNameForOllamaModel("qwen3.5:9b")).toBe("Qwen 3.5 9B");
    expect(displayNameForOllamaModel("llama3.2:latest")).toBe("Llama 3.2 3B");
    expect(displayNameForOllamaModel("codeqwen:7b-code")).toBe("CodeQwen 7B Code");
  });

  test("merged Ollama models dedupe normalized installed ids", () => {
    const models = mergeOllamaModels([
      {
        id: "llama3.2:latest",
        name: "llama3.2:latest",
        provider: "ollama",
        installed: true,
      },
      {
        id: "qwen3.5:9b",
        name: "qwen3.5:9b",
        provider: "ollama",
        installed: true,
      },
    ]);

    expect(models.filter((model) => model.id === "llama3.2")).toHaveLength(1);
    expect(models.find((model) => model.id === "llama3.2")).toMatchObject({
      name: "Llama 3.2 3B",
      installed: true,
    });
    expect(models.find((model) => model.id === "qwen3.5:9b")).toMatchObject({
      name: "Qwen 3.5 9B",
      installed: true,
    });
    expect(models.map((model) => model.name)).not.toContain("llama3.2");
    expect(models.map((model) => model.name)).not.toContain("codeqwen:7b-code");
  });
});
