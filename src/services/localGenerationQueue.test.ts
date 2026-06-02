import { describe, expect, it } from "vitest";
import {
  canQueueLocalMainGeneration,
  dequeueNextLocalMainGeneration,
  removeQueuedLocalMainGeneration,
  shouldBlockSameLoomMainGeneration,
  type LocalMainGenerationQueueItem,
} from "./localGenerationQueue";

describe("canQueueLocalMainGeneration", () => {
  it("accepts different Loom Main requests while local Ollama is active", () => {
    expect(
      canQueueLocalMainGeneration({
        active: true,
        activeLoomId: "loom-a",
        targetLoomId: "loom-b",
        providerKind: "ollama",
        generationType: "main",
        modelId: "qwen3:8b",
      })
    ).toBe(true);
  });

  it("rejects same Loom second Main requests", () => {
    expect(
      canQueueLocalMainGeneration({
        active: true,
        activeLoomId: "loom-a",
        targetLoomId: "loom-a",
        providerKind: "ollama",
        generationType: "main",
        modelId: "qwen3:8b",
      })
    ).toBe(false);
    expect(
      shouldBlockSameLoomMainGeneration({
        active: true,
        activeLoomId: "loom-a",
        targetLoomId: "loom-a",
      })
    ).toBe(true);
  });

  it("does not queue remote or non-main requests", () => {
    expect(
      canQueueLocalMainGeneration({
        active: true,
        activeLoomId: "loom-a",
        targetLoomId: "loom-b",
        providerKind: "openai_compatible",
        generationType: "main",
        modelId: "gpt-5",
      })
    ).toBe(false);
    expect(
      canQueueLocalMainGeneration({
        active: true,
        activeLoomId: "loom-a",
        targetLoomId: "loom-b",
        providerKind: "ollama",
        generationType: "quick",
        modelId: "qwen3:8b",
      })
    ).toBe(false);
  });
});

describe("local generation queue operations", () => {
  const first: LocalMainGenerationQueueItem<{ prompt: string }> = {
    id: "queue-1",
    loomId: "loom-b",
    responseId: "response-b",
    providerKind: "ollama",
    modelId: "qwen3:8b",
    payload: { prompt: "first" },
  };
  const second: LocalMainGenerationQueueItem<{ prompt: string }> = {
    id: "queue-2",
    loomId: "loom-c",
    responseId: "response-c",
    providerKind: "ollama",
    modelId: "qwen3:8b",
    payload: { prompt: "second" },
  };

  it("drains FIFO", () => {
    const result = dequeueNextLocalMainGeneration([first, second]);
    expect(result.next).toEqual(first);
    expect(result.remaining).toEqual([second]);
  });

  it("removes cancelled queued items without starting them", () => {
    const result = removeQueuedLocalMainGeneration([first, second], "queue-2");
    expect(result.removed).toEqual(second);
    expect(result.remaining).toEqual([first]);
  });
});
