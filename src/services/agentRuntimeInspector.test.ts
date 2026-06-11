import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AgentInspectorStreamError,
  EXPERIMENTAL_AGENT_RUN_ENDPOINT,
  isExperimentalAgentInspectorEnabled,
  sanitizeAgentRuntimeEvent,
  streamExperimentalAgentRun,
  type AgentInspectorEventRow,
} from "./agentRuntimeInspector";

function ndjsonResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    { status, headers: { "Content-Type": "application/x-ndjson" } }
  );
}

describe("experimental agent inspector gate", () => {
  it("is hidden by default outside development builds", () => {
    expect(isExperimentalAgentInspectorEnabled({ DEV: false })).toBe(false);
  });

  it("is enabled for development or an explicit build gate", () => {
    expect(isExperimentalAgentInspectorEnabled({ DEV: true })).toBe(true);
    expect(
      isExperimentalAgentInspectorEnabled({
        DEV: false,
        VITE_ENABLE_EXPERIMENTAL_AGENT_INSPECTOR: "true",
      })
    ).toBe(true);
  });
});

describe("sanitizeAgentRuntimeEvent", () => {
  it("keeps safe event fields and omits raw provider payload fields", () => {
    const event = sanitizeAgentRuntimeEvent({
      type: "provider_completed",
      run_id: "run-1",
      step_id: "step-1",
      done_reason: "stop",
      usage: { input_tokens: 4, output_tokens: 8 },
      provider_raw_payload: { secret: "must-not-render" },
      prompt: "must-not-render",
    });

    expect(event).toEqual({
      type: "provider_completed",
      runId: "run-1",
      stepId: "step-1",
      label: "Provider Completed",
      detail: "stop",
    });
    expect(JSON.stringify(event)).not.toContain("must-not-render");
  });

  it("redacts forbidden thinking and credential markers in allowed text fields", () => {
    const forbidden = [
      "raw_thinking",
      "thinking_text",
      "chain_of_thought",
      "hidden_reasoning",
      "Authorization",
      "Bearer abc123",
      "apiKey",
      "api_key",
      "provider raw payload",
    ];

    forbidden.forEach((value) => {
      const event = sanitizeAgentRuntimeEvent({
        type: "provider_delta",
        run_id: "run-1",
        step_id: "step-1",
        delta: value,
      });
      expect(event.detail).toBe("[redacted]");
    });
  });

  it("maps every terminal event to a stable inspector status", () => {
    expect(
      sanitizeAgentRuntimeEvent({ type: "run_completed", run_id: "run-1", elapsed_ms: 1 })
        .terminalStatus
    ).toBe("completed");
    expect(
      sanitizeAgentRuntimeEvent({ type: "run_failed", run_id: "run-2", error_message: "safe" })
        .terminalStatus
    ).toBe("failed");
    expect(
      sanitizeAgentRuntimeEvent({ type: "run_cancelled", run_id: "run-3" }).terminalStatus
    ).toBe("cancelled");
  });
});

describe("streamExperimentalAgentRun", () => {
  it("uses only the experimental endpoint and parses split NDJSON chunks", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ndjsonResponse([
        '{"type":"run_started","run_id":"run-1","loom_id":null}\n{"type":"provider_',
        'delta","run_id":"run-1","step_id":"step-1","delta":"Hello"}\n',
        '{"type":"run_completed","run_id":"run-1","elapsed_ms":12}\n',
      ])
    );
    const events: AgentInspectorEventRow[] = [];

    const result = await streamExperimentalAgentRun(
      { prompt: "Inspect this", temperature: 0.2, maxOutputTokens: 128 },
      { fetchImpl, onEvent: (event) => events.push(event) }
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe(EXPERIMENTAL_AGENT_RUN_ENDPOINT);
    expect(String(endpoint)).not.toContain("/orchestration/execute");
    expect(String(endpoint)).not.toContain("/ask/quick");
    expect(JSON.parse(String(init?.body))).toEqual({
      prompt: "Inspect this",
      providerOptions: { temperature: 0.2, maxOutputTokens: 128 },
    });
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "provider_delta",
      "run_completed",
    ]);
    expect(result).toEqual({ terminalStatus: "completed", runId: "run-1" });
  });

  it("surfaces non-200, invalid JSON, and incomplete streams as safe errors", async () => {
    await expect(
      streamExperimentalAgentRun(
        { prompt: "test" },
        { fetchImpl: async () => ndjsonResponse([], 404), onEvent: () => undefined }
      )
    ).rejects.toThrow("Experimental Agent Runtime is not enabled in loom-service.");

    await expect(
      streamExperimentalAgentRun(
        { prompt: "test" },
        { fetchImpl: async () => ndjsonResponse(["not-json\n"]), onEvent: () => undefined }
      )
    ).rejects.toBeInstanceOf(AgentInspectorStreamError);

    await expect(
      streamExperimentalAgentRun(
        { prompt: "test" },
        {
          fetchImpl: async () =>
            ndjsonResponse(['{"type":"run_started","run_id":"run-1"}\n']),
          onEvent: () => undefined,
        }
      )
    ).rejects.toThrow("without a terminal event");
  });

  it("keeps the inspector client isolated from Main and Quick endpoints", () => {
    const source = readFileSync(new URL("./agentRuntimeInspector.ts", import.meta.url), "utf8");
    expect(source).toContain('/__loom/experimental/agent/run');
    expect(source).not.toContain('/orchestration/execute');
    expect(source).not.toContain('/ask/quick');
  });
});
