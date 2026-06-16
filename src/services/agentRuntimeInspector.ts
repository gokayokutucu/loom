export const EXPERIMENTAL_AGENT_RUN_ENDPOINT = "/__loom/experimental/agent/run";
export const EXPERIMENTAL_AGENT_RUNS_ENDPOINT = "/__loom/experimental/agent/runs";

const FORBIDDEN_TEXT =
  /raw_thinking|thinking_text|chain_of_thought|hidden_reasoning|authorization|bearer\s+|api[_-]?key|secret|password|credential|provider(?:_|\s)?raw(?:_|\s)?payload|provider[_-]?payload|prompt|messages/i;

const FORBIDDEN_PAYLOAD_KEY =
  /raw_thinking|thinking_text|chain_of_thought|hidden_reasoning|authorization|bearer|api[_-]?key|secret|password|credential|provider(?:_|\s)?raw(?:_|\s)?payload|provider[_-]?payload|prompt|messages|delta|output[_-]?summary/i;

const SAFE_PAYLOAD_KEYS = new Set([
  "runId",
  "run_id",
  "stepId",
  "step_id",
  "toolName",
  "tool_name",
  "reason",
  "doneReason",
  "done_reason",
  "elapsedMs",
  "elapsed_ms",
  "inputTokens",
  "input_tokens",
  "outputTokens",
  "output_tokens",
  "totalTokens",
  "total_tokens",
  "status",
  "kind",
  "errorCode",
  "error_code",
]);

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

export interface AgentInspectorRunRecord {
  agentRunId: string;
  loomId?: string;
  responseId?: string;
  parentResponseId?: string;
  correlationId?: string;
  contextSnapshotId?: string;
  providerProfileId?: string;
  modelId?: string;
  status: string;
  cancelRequested: boolean;
  startedAt: string;
  completedAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  errorMessage?: string;
}

export interface AgentInspectorStepRecord {
  agentStepId: string;
  agentRunId: string;
  kind: string;
  status: string;
  sequenceIndex: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
}

export interface AgentInspectorHistoryEvent {
  agentEventId: string;
  agentRunId: string;
  agentStepId?: string;
  sequenceNumber: number;
  eventType: string;
  payload: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface AgentInspectorRunsResult {
  runs: AgentInspectorRunRecord[];
  count: number;
}

export interface AgentInspectorStepsResult {
  steps: AgentInspectorStepRecord[];
  count: number;
}

export interface AgentInspectorEventsResult {
  events: AgentInspectorHistoryEvent[];
  count: number;
  hasMore: boolean;
}

interface HistoryFetchOptions {
  fetchImpl?: typeof fetch;
}

interface ListRunsInput extends HistoryFetchOptions {
  loomId: string;
  limit?: number;
}

interface ListEventsInput extends HistoryFetchOptions {
  limit?: number;
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalSafeString(value: unknown): string | undefined {
  return safeString(value);
}

function safeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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
      return { ...base, detail: "Visible answer delta" };
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

function endpoint(path: string): string {
  return `${EXPERIMENTAL_AGENT_RUNS_ENDPOINT}${path}`;
}

async function fetchJson(
  input: RequestInfo | URL,
  options: HistoryFetchOptions = {}
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(input);
  } catch {
    throw new AgentInspectorStreamError("Agent history could not be reached.");
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new AgentInspectorStreamError(
        "Experimental Agent Runtime history is not enabled in loom-service."
      );
    }
    throw new AgentInspectorStreamError(`Agent history request failed (${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new AgentInspectorStreamError("Agent history returned invalid data.");
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new AgentInspectorStreamError(message);
  return value;
}

function mapRunRecord(value: unknown): AgentInspectorRunRecord {
  const record = requireRecord(value, "Agent history returned an invalid run.");
  const agentRunId = optionalString(record.agentRunId);
  const status = optionalString(record.status);
  const startedAt = optionalString(record.startedAt);
  const cancelRequested = safeBoolean(record.cancelRequested);
  if (!agentRunId || !status || !startedAt || cancelRequested === undefined) {
    throw new AgentInspectorStreamError("Agent history returned an invalid run.");
  }
  return {
    agentRunId,
    loomId: optionalSafeString(record.loomId),
    responseId: optionalSafeString(record.responseId),
    parentResponseId: optionalSafeString(record.parentResponseId),
    correlationId: optionalSafeString(record.correlationId),
    contextSnapshotId: optionalSafeString(record.contextSnapshotId),
    providerProfileId: optionalSafeString(record.providerProfileId),
    modelId: optionalSafeString(record.modelId),
    status,
    cancelRequested,
    startedAt,
    completedAt: optionalString(record.completedAt),
    inputTokens: safeNumber(record.inputTokens),
    outputTokens: safeNumber(record.outputTokens),
    totalTokens: safeNumber(record.totalTokens),
    errorMessage: optionalSafeString(record.errorMessage),
  };
}

function mapStepRecord(value: unknown): AgentInspectorStepRecord {
  const record = requireRecord(value, "Agent history returned an invalid step.");
  const agentStepId = optionalString(record.agentStepId);
  const agentRunId = optionalString(record.agentRunId);
  const kind = optionalString(record.kind);
  const status = optionalString(record.status);
  const sequenceIndex = safeNumber(record.sequenceIndex);
  const createdAt = optionalString(record.createdAt);
  if (!agentStepId || !agentRunId || !kind || !status || sequenceIndex === undefined || !createdAt) {
    throw new AgentInspectorStreamError("Agent history returned an invalid step.");
  }
  return {
    agentStepId,
    agentRunId,
    kind,
    status,
    sequenceIndex,
    startedAt: optionalString(record.startedAt),
    completedAt: optionalString(record.completedAt),
    error: optionalSafeString(record.error),
    createdAt,
  };
}

export function sanitizeAgentHistoryPayload(
  payloadJson: unknown
): Record<string, string | number | boolean> {
  if (typeof payloadJson !== "string" || payloadJson.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  return Object.entries(parsed).reduce<Record<string, string | number | boolean>>(
    (safePayload, [key, value]) => {
      if (!SAFE_PAYLOAD_KEYS.has(key) || FORBIDDEN_PAYLOAD_KEY.test(key)) return safePayload;
      if (typeof value === "string") {
        const safeValue = safeString(value);
        if (safeValue !== undefined && safeValue !== "[redacted]") safePayload[key] = safeValue;
        return safePayload;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        safePayload[key] = value;
        return safePayload;
      }
      if (typeof value === "boolean") {
        safePayload[key] = value;
      }
      return safePayload;
    },
    {}
  );
}

function mapHistoryEvent(value: unknown): AgentInspectorHistoryEvent {
  const record = requireRecord(value, "Agent history returned an invalid event.");
  const agentEventId = optionalString(record.agentEventId);
  const agentRunId = optionalString(record.agentRunId);
  const sequenceNumber = safeNumber(record.sequenceNumber);
  const eventType = optionalString(record.eventType);
  const createdAt = optionalString(record.createdAt);
  if (!agentEventId || !agentRunId || sequenceNumber === undefined || !eventType || !createdAt) {
    throw new AgentInspectorStreamError("Agent history returned an invalid event.");
  }
  return {
    agentEventId,
    agentRunId,
    agentStepId: optionalString(record.agentStepId),
    sequenceNumber,
    eventType,
    payload: sanitizeAgentHistoryPayload(record.payloadJson),
    createdAt,
  };
}

export async function listAgentRunHistory(input: ListRunsInput): Promise<AgentInspectorRunsResult> {
  const loomId = input.loomId.trim();
  if (!loomId) throw new AgentInspectorStreamError("Enter a Loom ID to load Agent run history.");
  const params = new URLSearchParams({ loomId });
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  const payload = requireRecord(
    await fetchJson(`${EXPERIMENTAL_AGENT_RUNS_ENDPOINT}?${params.toString()}`, input),
    "Agent history returned an invalid run list."
  );
  const runs = Array.isArray(payload.runs) ? payload.runs.map(mapRunRecord) : undefined;
  const count = safeNumber(payload.count);
  if (!runs || count === undefined) {
    throw new AgentInspectorStreamError("Agent history returned an invalid run list.");
  }
  return { runs, count };
}

export async function getAgentRunHistory(
  runId: string,
  options: HistoryFetchOptions = {}
): Promise<AgentInspectorRunRecord> {
  const trimmedRunId = runId.trim();
  if (!trimmedRunId) throw new AgentInspectorStreamError("Agent run ID is required.");
  return mapRunRecord(await fetchJson(endpoint(`/${encodeURIComponent(trimmedRunId)}`), options));
}

export async function listAgentRunSteps(
  runId: string,
  options: HistoryFetchOptions = {}
): Promise<AgentInspectorStepsResult> {
  const trimmedRunId = runId.trim();
  if (!trimmedRunId) throw new AgentInspectorStreamError("Agent run ID is required.");
  const payload = requireRecord(
    await fetchJson(endpoint(`/${encodeURIComponent(trimmedRunId)}/steps`), options),
    "Agent history returned an invalid step list."
  );
  const steps = Array.isArray(payload.steps) ? payload.steps.map(mapStepRecord) : undefined;
  const count = safeNumber(payload.count);
  if (!steps || count === undefined) {
    throw new AgentInspectorStreamError("Agent history returned an invalid step list.");
  }
  return { steps, count };
}

export async function listAgentRunEvents(
  runId: string,
  input: ListEventsInput = {}
): Promise<AgentInspectorEventsResult> {
  const trimmedRunId = runId.trim();
  if (!trimmedRunId) throw new AgentInspectorStreamError("Agent run ID is required.");
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const payload = requireRecord(
    await fetchJson(endpoint(`/${encodeURIComponent(trimmedRunId)}/events${suffix}`), input),
    "Agent history returned an invalid event list."
  );
  const events = Array.isArray(payload.events) ? payload.events.map(mapHistoryEvent) : undefined;
  const count = safeNumber(payload.count);
  const hasMore = safeBoolean(payload.hasMore);
  if (!events || count === undefined || hasMore === undefined) {
    throw new AgentInspectorStreamError("Agent history returned an invalid event list.");
  }
  return { events, count, hasMore };
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
