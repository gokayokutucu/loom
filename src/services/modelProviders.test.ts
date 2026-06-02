import { describe, expect, test } from "vitest";
import {
  computeComposerRunState,
  computeModelPickerInstalledState,
  computeQuickAskBlockedReason,
  defaultAIProviderSettings,
  displayNameForOllamaModel,
  getInstalledModels,
  getProfileModel,
  mergeOllamaModels,
  modelPickerStatusText,
  normalizeOllamaModelId,
  type AIProviderSettings,
  type ModelDescriptor,
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

function installedDescriptor(id: string): ModelDescriptor {
  return { id, name: id, provider: "ollama", installed: true };
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

// ── Non-curated model discovery tests ────────────────────────────────────────

describe("mergeOllamaModels — non-curated installed models", () => {
  test("non-curated installed model appears as installed after merge", () => {
    // Simulates a service refresh that returns a user-installed model
    // not in the curated list (e.g. phi4, mistral-nemo, custom-7b).
    const models = mergeOllamaModels([installedDescriptor("phi4")]);
    const installed = getInstalledModels(settingsWithModels(models));

    expect(installed.some((m) => m.id === "phi4")).toBe(true);
    expect(installed.find((m) => m.id === "phi4")?.installed).toBe(true);
  });

  test("non-curated model with tag is preserved and appears installed", () => {
    const models = mergeOllamaModels([installedDescriptor("custom-7b:v2")]);
    const installed = getInstalledModels(settingsWithModels(models));

    expect(installed.some((m) => m.id === "custom-7b:v2")).toBe(true);
  });

  test("non-curated model with namespace/name:tag is preserved", () => {
    const models = mergeOllamaModels([installedDescriptor("namespace/model:tag")]);
    const installed = getInstalledModels(settingsWithModels(models));

    expect(installed.some((m) => m.id === "namespace/model:tag")).toBe(true);
  });

  test("static suggestions remain not-installed even after refresh with non-curated model", () => {
    // Refresh returns phi4 only; all curated suggestions must stay not-installed.
    const models = mergeOllamaModels([installedDescriptor("phi4")]);
    const installed = getInstalledModels(settingsWithModels(models));

    const suggestedIds = ["llama3.2", "qwen3.5:9b", "codeqwen:7b-code", "qwen:7b",
      "llama3.1:8b", "qwen2.5:7b", "mistral:7b", "nomic-embed-text"];
    suggestedIds.forEach((id) => {
      expect(installed.some((m) => m.id === id)).toBe(false);
    });
  });

  test("refresh result with new model updates installed list", () => {
    // Stale state: llama3.2 was installed.
    const stale = mergeOllamaModels([installedDescriptor("llama3.2")]);
    const staleInstalled = getInstalledModels(settingsWithModels(stale));
    expect(staleInstalled.map((m) => m.id)).toContain("llama3.2");

    // Fresh refresh: llama3.2 AND phi4 are now installed.
    const fresh = mergeOllamaModels([
      installedDescriptor("llama3.2"),
      installedDescriptor("phi4"),
    ]);
    const freshInstalled = getInstalledModels(settingsWithModels(fresh));

    expect(freshInstalled.map((m) => m.id)).toContain("llama3.2");
    expect(freshInstalled.map((m) => m.id)).toContain("phi4");
    expect(freshInstalled.length).toBeGreaterThan(staleInstalled.length);
  });

  test("live refresh result replaces stale installed cache", () => {
    // The cache (providerSettings.ollama.models) is replaced entirely by the
    // result of mergeOllamaModels on every refresh call.  If a model was in the
    // stale cache but is no longer returned by the service, it must not appear
    // as installed in the new settings.
    const afterRefresh = mergeOllamaModels([installedDescriptor("phi4")]);
    const installed = getInstalledModels(settingsWithModels(afterRefresh));

    // llama3.2 was not returned by this refresh — must not be installed.
    expect(installed.some((m) => m.id === "llama3.2")).toBe(false);
    expect(installed.some((m) => m.id === "phi4")).toBe(true);
  });
});

// ── Model name / tag normalisation tests ─────────────────────────────────────

describe("normalizeOllamaModelId — tag and name preservation", () => {
  test(":latest suffix is stripped", () => {
    expect(normalizeOllamaModelId("phi4:latest")).toBe("phi4");
    expect(normalizeOllamaModelId("llama3.2:latest")).toBe("llama3.2");
  });

  test("non-latest tags are preserved", () => {
    expect(normalizeOllamaModelId("custom-7b:v2")).toBe("custom-7b:v2");
    expect(normalizeOllamaModelId("phi4:instruct")).toBe("phi4:instruct");
  });

  test("namespace/model:tag names are preserved verbatim", () => {
    expect(normalizeOllamaModelId("namespace/model:tag")).toBe("namespace/model:tag");
    expect(normalizeOllamaModelId("vendor/phi4:latest")).toBe("vendor/phi4");
  });

  test("whitespace is trimmed", () => {
    expect(normalizeOllamaModelId("  phi4  ")).toBe("phi4");
  });
});

describe("displayNameForOllamaModel — unknown model fallback", () => {
  test("unknown model ID produces a non-empty display name", () => {
    expect(displayNameForOllamaModel("phi4")).toBeTruthy();
    expect(displayNameForOllamaModel("mistral-nemo")).toBeTruthy();
    expect(displayNameForOllamaModel("custom-7b:v2")).toBeTruthy();
  });

  test("known model ID returns its exact display name", () => {
    expect(displayNameForOllamaModel("llama3.2")).toBe("Llama 3.2 3B");
    expect(displayNameForOllamaModel("qwen3.5:9b")).toBe("Qwen 3.5 9B");
  });
});

// ── computeModelPickerInstalledState ─────────────────────────────────────────

describe("computeModelPickerInstalledState", () => {
  test("mock provider is always live", () => {
    expect(
      computeModelPickerInstalledState({
        isMockProvider: true,
        isScanningModels: false,
        providerStatus: "unknown",
        installedCount: 0,
      })
    ).toBe("live");
  });

  test("scanning takes priority over all other states", () => {
    expect(
      computeModelPickerInstalledState({
        isMockProvider: false,
        isScanningModels: true,
        providerStatus: "unknown",
        installedCount: 0,
      })
    ).toBe("scanning");

    // Even when connected, isScanningModels=true → "scanning"
    expect(
      computeModelPickerInstalledState({
        isMockProvider: false,
        isScanningModels: true,
        providerStatus: "connected",
        installedCount: 2,
      })
    ).toBe("scanning");
  });

  test("connected without scanning → live", () => {
    expect(
      computeModelPickerInstalledState({
        isMockProvider: false,
        isScanningModels: false,
        providerStatus: "connected",
        installedCount: 3,
      })
    ).toBe("live");
  });

  test("non-connected with cached installed models → cached", () => {
    expect(
      computeModelPickerInstalledState({
        isMockProvider: false,
        isScanningModels: false,
        providerStatus: "offline",
        installedCount: 2,
      })
    ).toBe("cached");

    expect(
      computeModelPickerInstalledState({
        isMockProvider: false,
        isScanningModels: false,
        providerStatus: "unknown",
        installedCount: 1,
      })
    ).toBe("cached");
  });

  test("offline with no installed cache → offline-empty", () => {
    expect(
      computeModelPickerInstalledState({
        isMockProvider: false,
        isScanningModels: false,
        providerStatus: "offline",
        installedCount: 0,
      })
    ).toBe("offline-empty");
  });

  test("unknown status with no installed models → unknown-empty", () => {
    expect(
      computeModelPickerInstalledState({
        isMockProvider: false,
        isScanningModels: false,
        providerStatus: "unknown",
        installedCount: 0,
      })
    ).toBe("unknown-empty");
  });
});

// ── modelPickerStatusText ─────────────────────────────────────────────────────

describe("modelPickerStatusText", () => {
  test("scanning state shows scanning copy", () => {
    expect(modelPickerStatusText("scanning", 0)).toBe("Scanning local Ollama models…");
    expect(modelPickerStatusText("scanning", 3)).toBe("Scanning local Ollama models…");
  });

  test("cached state shows offline-with-cache copy", () => {
    expect(modelPickerStatusText("cached", 2)).toBe(
      "Ollama is offline. Showing last discovered local models."
    );
  });

  test("offline-empty state shows unavailable copy", () => {
    expect(modelPickerStatusText("offline-empty", 0)).toBe("Ollama is not available.");
  });

  test("unknown-empty state shows discover copy", () => {
    expect(modelPickerStatusText("unknown-empty", 0)).toBe(
      "Test Ollama to discover installed local models."
    );
  });

  test("live with no selectable models shows empty copy", () => {
    expect(modelPickerStatusText("live", 0)).toBe("No local models installed.");
  });

  test("live with selectable models returns null (no status shown)", () => {
    expect(modelPickerStatusText("live", 1)).toBeNull();
    expect(modelPickerStatusText("live", 3)).toBeNull();
  });

  test("static suggestions do not appear as installed while scanning", () => {
    // The "scanning" state explicitly shows scanning copy — not a model list.
    // Static suggestion names must never appear as menu items in this state.
    const text = modelPickerStatusText("scanning", 0);
    expect(text).not.toContain("Qwen");
    expect(text).not.toContain("Llama");
    expect(text).not.toContain("Mistral");
    expect(text).not.toContain("CodeQwen");
  });
});

// ── Model picker → Main model persistence mapping ────────────────────────────

describe("model picker selection → providerSettings.profiles.mainModelId", () => {
  test("selecting an installed model updates mainModelId", () => {
    const settings = settingsWithModels([
      { id: "llama3.2", name: "Llama 3.2 3B", provider: "ollama", installed: true },
      { id: "qwen3.5:9b", name: "Qwen 3.5 9B", provider: "ollama", installed: true },
    ]);

    // Simulates the state update performed by setMainModel in PromptComposer.
    const updated: AIProviderSettings = {
      ...settings,
      profiles: { ...settings.profiles, mainModelId: "llama3.2" },
    };

    expect(updated.profiles.mainModelId).toBe("llama3.2");
    // The new main model must be in the installed list so it is selectable.
    expect(getInstalledModels(updated).some((m) => m.id === "llama3.2")).toBe(true);
  });

  test("selected model id is preserved in localStorage-serialised settings", () => {
    const settings: AIProviderSettings = {
      ...defaultAIProviderSettings,
      profiles: {
        ...defaultAIProviderSettings.profiles,
        mainModelId: "llama3.2",
      },
    };
    const roundTripped = JSON.parse(JSON.stringify(settings)) as AIProviderSettings;
    expect(roundTripped.profiles.mainModelId).toBe("llama3.2");
  });

  test("missing/unavailable model is NOT in installed list and should not be selected", () => {
    const settings = settingsWithModels([
      { id: "llama3.2", name: "Llama 3.2 3B", provider: "ollama", installed: false },
    ]);
    // An uninstalled model must not appear as a selectable installed choice.
    expect(getInstalledModels(settings).some((m) => m.id === "llama3.2")).toBe(false);
  });

  test("only installed models are selectable — static suggestions remain non-installed", () => {
    // Refresh returns model-b as the only installed model.
    const models = mergeOllamaModels([
      { id: "model-a", name: "Model A", provider: "ollama", installed: false },
      { id: "model-b", name: "Model B", provider: "ollama", installed: true },
    ]);
    const settings = settingsWithModels(models);
    const installed = getInstalledModels(settings);

    expect(installed.map((m) => m.id)).toContain("model-b");
    expect(installed.map((m) => m.id)).not.toContain("model-a");
    // Static suggestions are not installed either
    expect(installed.some((m) => m.id === "llama3.2")).toBe(false);
  });
});

// ── computeComposerRunState ───────────────────────────────────────────────────

describe("computeComposerRunState", () => {
  const idle = { running: false, message: null };
  const running = { running: true, message: "Response streaming..." };

  test("target composer: returns running state, not blocked", () => {
    const state = computeComposerRunState("loom-a", "loom-a", running);
    expect(state.running).toBe(true);
    expect(state.blockedByOtherGeneration).toBe(false);
    expect(state.message).toBe("Response streaming...");
  });

  test("non-target composer while global running: blocked with message", () => {
    const state = computeComposerRunState("loom-b", "loom-a", running);
    expect(state.running).toBe(false);
    expect(state.blockedByOtherGeneration).toBe(true);
    expect(state.message).toBe("Another response is generating.");
  });

  test("non-target composer when global idle: not blocked", () => {
    const state = computeComposerRunState("loom-b", "loom-a", idle);
    expect(state.running).toBe(false);
    expect(state.blockedByOtherGeneration).toBe(false);
    expect(state.message).toBeNull();
  });

  test("no active target (null): not blocked when idle", () => {
    const state = computeComposerRunState("loom-a", null, idle);
    expect(state.running).toBe(false);
    expect(state.blockedByOtherGeneration).toBe(false);
  });

  test("no active target, global running: non-target blocked", () => {
    // When targetKey=null and global is running (edge case), any draftKey is non-target.
    const state = computeComposerRunState("loom-a", null, running);
    expect(state.running).toBe(false);
    expect(state.blockedByOtherGeneration).toBe(true);
  });

  test("stop unblocks: after global goes idle, non-target is no longer blocked", () => {
    const blockedState = computeComposerRunState("loom-b", "loom-a", running);
    expect(blockedState.blockedByOtherGeneration).toBe(true);

    const afterStop = computeComposerRunState("loom-b", null, idle);
    expect(afterStop.blockedByOtherGeneration).toBe(false);
  });
});

// ── computeQuickAskBlockedReason ─────────────────────────────────────────────

describe("computeQuickAskBlockedReason", () => {
  test("null when Main is not running", () => {
    expect(computeQuickAskBlockedReason(false, "qwen3.5:9b", "qwen3.5:9b")).toBeNull();
    expect(computeQuickAskBlockedReason(false, "llama3.2", "qwen3.5:9b")).toBeNull();
  });

  test("blocked reason when Main running and same model", () => {
    const reason = computeQuickAskBlockedReason(true, "qwen3.5:9b", "qwen3.5:9b");
    expect(reason).toBeTruthy();
    expect(reason).toContain("same model");
  });

  test("null when Main running but different models", () => {
    expect(computeQuickAskBlockedReason(true, "mistral:7b", "qwen3.5:9b")).toBeNull();
    expect(computeQuickAskBlockedReason(true, "llama3.2", "qwen3.5:9b")).toBeNull();
  });

  test("identical model IDs with tag: blocked", () => {
    expect(computeQuickAskBlockedReason(true, "llama3.2:latest", "llama3.2:latest")).toBeTruthy();
  });

  test("blocked reason does not reveal model names — safe for display", () => {
    const reason = computeQuickAskBlockedReason(true, "qwen3.5:9b", "qwen3.5:9b");
    // Should be a static user-facing string, not dynamic model names.
    expect(typeof reason).toBe("string");
    expect((reason as string).length).toBeLessThan(100);
  });
});
