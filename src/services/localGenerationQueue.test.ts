import { describe, expect, it } from "vitest";
import {
  canQueueLocalMainGeneration,
  dequeueNextLocalMainGeneration,
  removeQueuedLocalMainGeneration,
  shouldBlockSameLoomMainGeneration,
  computeMainGenerationConcurrencyDecision,
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

describe("computeMainGenerationConcurrencyDecision", () => {
  it("allows local Main when no active runs", () => {
    const decision = computeMainGenerationConcurrencyDecision({
      providerProfileId: "ollama-local",
      providerKind: "ollama",
      modelId: "qwen",
      targetLoomId: "loom-a",
      activeRuns: [],
    });
    expect(decision).toBe("allow");
  });

  it("queues local Main when active local run is on a different Loom", () => {
    const decision = computeMainGenerationConcurrencyDecision({
      providerProfileId: "ollama-local",
      providerKind: "ollama",
      modelId: "qwen",
      targetLoomId: "loom-b",
      activeRuns: [
        {
          loomId: "loom-a",
          providerProfileId: "ollama-local",
          providerKind: "ollama",
          modelId: "qwen",
          startedAt: new Date().toISOString(),
        },
      ],
    });
    expect(decision).toBe("queue");
  });

  it("blocks local/remote Main on same Loom when that Loom is already active", () => {
    const decision = computeMainGenerationConcurrencyDecision({
      providerProfileId: "nvidia",
      providerKind: "openai_compatible",
      modelId: "meta/llama-3",
      targetLoomId: "loom-a",
      activeRuns: [
        {
          loomId: "loom-a",
          providerProfileId: "nvidia",
          providerKind: "openai_compatible",
          modelId: "meta/llama-3",
          startedAt: new Date().toISOString(),
        },
      ],
    });
    expect(decision).toBe("block_same_loom");
  });

  it("allows remote Main when active count for same provider profile < 2", () => {
    const decision = computeMainGenerationConcurrencyDecision({
      providerProfileId: "nvidia",
      providerKind: "openai_compatible",
      modelId: "meta/llama-3",
      targetLoomId: "loom-b",
      activeRuns: [
        {
          loomId: "loom-a",
          providerProfileId: "nvidia",
          providerKind: "openai_compatible",
          modelId: "meta/llama-3",
          startedAt: new Date().toISOString(),
        },
      ],
    });
    expect(decision).toBe("allow");
  });

  it("blocks remote Main when active count for same provider profile >= 2", () => {
    const decision = computeMainGenerationConcurrencyDecision({
      providerProfileId: "nvidia",
      providerKind: "openai_compatible",
      modelId: "meta/llama-3",
      targetLoomId: "loom-c",
      activeRuns: [
        {
          loomId: "loom-a",
          providerProfileId: "nvidia",
          providerKind: "openai_compatible",
          modelId: "meta/llama-3",
          startedAt: new Date().toISOString(),
        },
        {
          loomId: "loom-b",
          providerProfileId: "nvidia",
          providerKind: "openai_compatible",
          modelId: "meta/llama-3",
          startedAt: new Date().toISOString(),
        },
      ],
    });
    expect(decision).toBe("block_limit_exceeded");
  });
});
