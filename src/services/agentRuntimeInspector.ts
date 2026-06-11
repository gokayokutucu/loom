export const EXPERIMENTAL_AGENT_RUN_ENDPOINT = "/__loom/experimental/agent/run";

const FORBIDDEN_TEXT =
  /raw_thinking|thinking_text|chain_of_thought|hidden_reasoning|authorization|bearer\s+|api[_-]?key|provider(?:_|\s)?raw(?:_|\s)?payload/i;

export type AgentInspectorTerminalStatus = "completed" | "failed" | "cancelled";

export interface AgentInspectorRunInput {
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AgentInspectorEventRow {
  type: string;
  runId?: string;
  stepId?: string;
  label: string;
  detail?: string;
  terminalStatus?: AgentInspectorTerminalStatus;
}

export interface AgentInspectorStreamResult {
  terminalStatus: AgentInspectorTerminalStatus;
  runId?: string;
}

interface InspectorEnvironment {
  DEV?: boolean;
  VITE_ENABLE_EXPERIMENTAL_AGENT_INSPECTOR?: string;
}

interface StreamOptions {
  signal?: AbortSignal;
  onEvent: (event: AgentInspectorEventRow) => void;
  fetchImpl?: typeof fetch;
}

export class AgentInspectorStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentInspectorStreamError";
  }
}

export function isExperimentalAgentInspectorEnabled(
  environment: InspectorEnvironment = import.meta.env
): boolean {
  return (
    environment.DEV === true ||
    environment.VITE_ENABLE_EXPERIMENTAL_AGENT_INSPECTOR === "true"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return FORBIDDEN_TEXT.test(value) ? "[redacted]" : value;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function titleForEvent(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function sanitizeAgentRuntimeEvent(value: unknown): AgentInspectorEventRow {
  if (!isRecord(value)) {
    return { type: "unknown", label: "Unknown event" };
  }

  const type = safeString(value.type) ?? "unknown";
  const runId = safeString(value.run_id);
  const stepId = safeString(value.step_id);
  const base = { type, runId, stepId, label: titleForEvent(type) || "Unknown event" };

  switch (type) {
    case "run_started":
      return { ...base, detail: safeString(value.loom_id) ? "Run accepted for Loom" : "Run accepted" };
    case "step_started":
      return { ...base, detail: safeString(value.kind) ?? "Step started" };
    case "provider_delta":
      return { ...base, detail: safeString(value.delta) ?? "Visible answer delta" };
    case "provider_completed": {
      const doneReason = safeString(value.done_reason);
      const usage = isRecord(value.usage) ? value.usage : undefined;
      const inputTokens = safeNumber(usage?.input_tokens);
      const outputTokens = safeNumber(usage?.output_tokens);
      const tokenDetail = [
        inputTokens === undefined ? undefined : `${inputTokens} input`,
        outputTokens === undefined ? undefined : `${outputTokens} output`,
      ]
        .filter(Boolean)
        .join(" · ");
      return { ...base, detail: doneReason ?? (tokenDetail || "Provider completed") };
    }
    case "tool_call_requested":
      return { ...base, detail: safeString(value.tool_name) ?? "Tool requested" };
    case "tool_call_skipped":
      return {
        ...base,
        detail: [safeString(value.tool_name), safeString(value.reason)].filter(Boolean).join(" · ") || "Tool skipped",
      };
    case "artifact_created":
      return { ...base, detail: safeString(value.artifact_id) ?? "Artifact created" };
    case "warning":
      return { ...base, detail: safeString(value.message) ?? "Runtime warning" };
    case "run_completed": {
      const elapsedMs = safeNumber(value.elapsed_ms);
      return {
        ...base,
        detail: elapsedMs === undefined ? "Run completed" : `${elapsedMs} ms`,
        terminalStatus: "completed",
      };
    }
    case "run_failed":
      return {
        ...base,
        detail: safeString(value.error_message) ?? "Agent run failed",
        terminalStatus: "failed",
      };
    case "run_cancelled":
      return { ...base, detail: "Run cancelled", terminalStatus: "cancelled" };
    default:
      return base;
  }
}

function requestBody(input: AgentInspectorRunInput) {
  const providerOptions = {
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: input.maxOutputTokens }),
  };

  return {
    prompt: input.prompt,
    ...(Object.keys(providerOptions).length === 0 ? {} : { providerOptions }),
  };
}

function terminalResult(event: AgentInspectorEventRow): AgentInspectorStreamResult | undefined {
  if (!event.terminalStatus) return undefined;
  return { terminalStatus: event.terminalStatus, runId: event.runId };
}

export async function streamExperimentalAgentRun(
  input: AgentInspectorRunInput,
  options: StreamOptions
): Promise<AgentInspectorStreamResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(EXPERIMENTAL_AGENT_RUN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody(input)),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AgentInspectorStreamError("Agent runtime could not be reached.");
  }

  if (!response.ok) {
    throw new AgentInspectorStreamError(
      response.status === 404
        ? "Experimental Agent Runtime is not enabled in loom-service."
        : `Agent runtime request failed (${response.status}).`
    );
  }
  if (!response.body) {
    throw new AgentInspectorStreamError("Agent runtime returned an empty stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: AgentInspectorStreamResult | undefined;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new AgentInspectorStreamError("Agent runtime returned invalid stream data.");
    }
    const event = sanitizeAgentRuntimeEvent(parsed);
    options.onEvent(event);
    terminal = terminalResult(event) ?? terminal;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(consumeLine);
      if (done) break;
    }
    consumeLine(buffer);
  } catch (error) {
    if (error instanceof AgentInspectorStreamError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AgentInspectorStreamError("Agent runtime stream ended unexpectedly.");
  } finally {
    reader.releaseLock();
  }

  if (!terminal) {
    throw new AgentInspectorStreamError("Agent runtime stream ended without a terminal event.");
  }
  return terminal;
}
