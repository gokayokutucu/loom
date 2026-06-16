import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AgentInspectorStreamError,
  EXPERIMENTAL_AGENT_RUN_ENDPOINT,
  EXPERIMENTAL_AGENT_RUNS_ENDPOINT,
  listAgentRunEvents,
  listAgentRunHistory,
  listAgentRunSteps,
  isExperimentalAgentInspectorEnabled,
  sanitizeAgentHistoryPayload,
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  it("does not render live provider delta text in the inspector row", () => {
    const event = sanitizeAgentRuntimeEvent({
      type: "provider_delta",
      run_id: "run-1",
      step_id: "step-1",
      delta: "provider text should not be rendered here",
    });

    expect(event.detail).toBe("Visible answer delta");
    expect(JSON.stringify(event)).not.toContain("provider text should not be rendered here");
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
        type: "warning",
        run_id: "run-1",
        step_id: "step-1",
        message: value,
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

describe("agent run history helpers", () => {
  it("loads Loom-scoped durable run summaries from the experimental history endpoint", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({
        runs: [
          {
            agentRunId: "run-1",
            loomId: "loom-1",
            responseId: "resp-1",
            parentResponseId: null,
            correlationId: "corr-1",
            causationId: null,
            contextSnapshotId: "ctx-1",
            providerProfileId: "ollama",
            modelId: "qwen",
            status: "completed",
            cancelRequested: false,
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:01Z",
            inputTokens: 4,
            outputTokens: 8,
            totalTokens: 12,
            errorMessage: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
        count: 1,
      })
    );

    const result = await listAgentRunHistory({ loomId: "loom-1", limit: 25, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      `${EXPERIMENTAL_AGENT_RUNS_ENDPOINT}?loomId=loom-1&limit=25`
    );
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({
      agentRunId: "run-1",
      loomId: "loom-1",
      responseId: "resp-1",
      providerProfileId: "ollama",
      modelId: "qwen",
      totalTokens: 12,
    });
  });

  it("loads steps and sanitized durable events for a selected run", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/steps")) {
        return jsonResponse({
          steps: [
            {
              agentStepId: "step-1",
              agentRunId: "run-1",
              kind: "provider",
              status: "completed",
              sequenceIndex: 1,
              startedAt: "2026-01-01T00:00:00Z",
              completedAt: "2026-01-01T00:00:01Z",
              error: null,
              createdAt: "2026-01-01T00:00:00Z",
            },
          ],
          count: 1,
        });
      }
      return jsonResponse({
        events: [
          {
            agentEventId: "event-1",
            agentRunId: "run-1",
            agentStepId: "step-1",
            sequenceNumber: 3,
            eventType: "provider_delta",
            payloadJson: JSON.stringify({
              delta: "provider delta must not render",
              prompt: "prompt must not render",
              doneReason: "stop",
              totalTokens: 9,
              Authorization: "Bearer secret",
            }),
            createdAt: "2026-01-01T00:00:01Z",
          },
        ],
        count: 1,
        hasMore: false,
      });
    });

    const steps = await listAgentRunSteps("run-1", { fetchImpl });
    const events = await listAgentRunEvents("run-1", { limit: 100, fetchImpl });

    expect(steps.steps[0]).toMatchObject({ agentStepId: "step-1", kind: "provider" });
    expect(events.events[0]).toMatchObject({
      agentEventId: "event-1",
      eventType: "provider_delta",
      payload: { doneReason: "stop", totalTokens: 9 },
    });
    expect(JSON.stringify(events)).not.toContain("provider delta must not render");
    expect(JSON.stringify(events)).not.toContain("prompt must not render");
    expect(JSON.stringify(events)).not.toContain("Bearer secret");
  });

  it("surfaces disabled experimental history as a safe unavailable state", async () => {
    await expect(
      listAgentRunHistory({
        loomId: "loom-1",
        fetchImpl: async () => jsonResponse({ code: "NOT_FOUND" }, 404),
      })
    ).rejects.toThrow("Experimental Agent Runtime history is not enabled in loom-service.");
  });

  it("requires a Loom ID before calling the history endpoint", async () => {
    const fetchImpl = vi.fn();

    await expect(listAgentRunHistory({ loomId: " ", fetchImpl })).rejects.toThrow(
      "Enter a Loom ID"
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allowlists durable payload fields and strips sensitive or verbose fields", () => {
    const payload = sanitizeAgentHistoryPayload(
      JSON.stringify({
        runId: "run-1",
        toolName: "loom.runtime.status",
        reason: "safe reason",
        totalTokens: 12,
        delta: "must-not-render",
        outputSummary: "must-not-render",
        raw_thinking: "must-not-render",
        apiKey: "must-not-render",
        provider_payload: "must-not-render",
      })
    );

    expect(payload).toEqual({
      runId: "run-1",
      toolName: "loom.runtime.status",
      reason: "safe reason",
      totalTokens: 12,
    });
    expect(JSON.stringify(payload)).not.toContain("must-not-render");
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
    expect(JSON.stringify(events)).not.toContain("Hello");
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
    expect(source).toContain('/__loom/experimental/agent/runs');
    expect(source).not.toContain('/orchestration/execute');
    expect(source).not.toContain('/ask/quick');
  });
});
