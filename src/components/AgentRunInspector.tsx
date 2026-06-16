import { useEffect, useRef, useState, type FormEvent } from "react";
import { FlaskConical, Play } from "lucide-react";
import {
  AgentInspectorStreamError,
  listAgentRunEvents,
  listAgentRunHistory,
  listAgentRunSteps,
  streamExperimentalAgentRun,
  type AgentInspectorHistoryEvent,
  type AgentInspectorEventRow,
  type AgentInspectorRunRecord,
  type AgentInspectorStepRecord,
  type AgentInspectorTerminalStatus,
} from "../services/agentRuntimeInspector";

type InspectorStatus = "idle" | "running" | AgentInspectorTerminalStatus | "error";
type HistoryStatus = "idle" | "loading" | "loaded" | "error";
type RunDetailStatus = "idle" | "loading" | "loaded" | "error";

function formatDateTime(value: string | undefined): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function shortId(value: string | undefined): string {
  if (!value) return "n/a";
  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function runUsage(run: AgentInspectorRunRecord): string {
  if (run.totalTokens !== undefined) return `${run.totalTokens} total tokens`;
  const parts = [
    run.inputTokens === undefined ? undefined : `${run.inputTokens} input`,
    run.outputTokens === undefined ? undefined : `${run.outputTokens} output`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "n/a";
}

function payloadDetail(payload: AgentInspectorHistoryEvent["payload"]): string {
  const entries = Object.entries(payload);
  if (entries.length === 0) return "Safe durable event";
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
}

export function AgentRunInspector({ enabled }: { enabled: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [events, setEvents] = useState<AgentInspectorEventRow[]>([]);
  const [status, setStatus] = useState<InspectorStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyLoomId, setHistoryLoomId] = useState("");
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [runs, setRuns] = useState<AgentInspectorRunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<AgentInspectorRunRecord | null>(null);
  const [detailStatus, setDetailStatus] = useState<RunDetailStatus>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentInspectorStepRecord[]>([]);
  const [historyEvents, setHistoryEvents] = useState<AgentInspectorHistoryEvent[]>([]);
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => activeControllerRef.current?.abort(), []);

  if (!enabled) return null;

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || status === "running") return;

    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setEvents([]);
    setErrorMessage(null);
    setStatus("running");

    try {
      const result = await streamExperimentalAgentRun(
        {
          prompt: trimmedPrompt,
          ...(temperature === "" ? {} : { temperature: Number(temperature) }),
          ...(maxOutputTokens === "" ? {} : { maxOutputTokens: Number(maxOutputTokens) }),
        },
        {
          signal: controller.signal,
          onEvent: (nextEvent) => setEvents((current) => [...current, nextEvent]),
        }
      );
      setStatus(result.terminalStatus);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error");
      setErrorMessage(
        error instanceof AgentInspectorStreamError
          ? error.message
          : "Agent runtime inspection failed."
      );
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
    }
  }

  async function loadHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (historyStatus === "loading") return;
    setHistoryStatus("loading");
    setHistoryError(null);
    setRuns([]);
    setSelectedRun(null);
    setSteps([]);
    setHistoryEvents([]);
    setDetailStatus("idle");
    setDetailError(null);

    try {
      const result = await listAgentRunHistory({ loomId: historyLoomId, limit: 50 });
      setRuns(result.runs);
      setHistoryStatus("loaded");
    } catch (error) {
      setHistoryStatus("error");
      setHistoryError(
        error instanceof AgentInspectorStreamError
          ? error.message
          : "Agent run history could not be loaded."
      );
    }
  }

  async function selectRun(run: AgentInspectorRunRecord) {
    setSelectedRun(run);
    setSteps([]);
    setHistoryEvents([]);
    setDetailStatus("loading");
    setDetailError(null);

    try {
      const [nextSteps, nextEvents] = await Promise.all([
        listAgentRunSteps(run.agentRunId),
        listAgentRunEvents(run.agentRunId, { limit: 100 }),
      ]);
      setSteps(nextSteps.steps);
      setHistoryEvents(nextEvents.events);
      setDetailStatus("loaded");
    } catch (error) {
      setDetailStatus("error");
      setDetailError(
        error instanceof AgentInspectorStreamError
          ? error.message
          : "Agent run details could not be loaded."
      );
    }
  }

  return (
    <section className="provider-section agent-run-inspector" data-testid="agent-run-inspector">
      <div className="provider-section-heading">
        <div>
          <span>Experimental</span>
          <h3>Agent Run Inspector</h3>
        </div>
        <span className="settings-planned-pill agent-run-inspector__badge">
          <FlaskConical size={12} /> Experimental
        </span>
      </div>

      <form className="agent-run-inspector__form" onSubmit={startRun}>
        <label className="settings-field agent-run-inspector__prompt">
          <span>Prompt</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Run a transient Agent Runtime inspection"
            disabled={status === "running"}
          />
        </label>
        <div className="agent-run-inspector__options">
          <label className="settings-field">
            <span>Temperature</span>
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
              placeholder="Runtime default"
              disabled={status === "running"}
            />
          </label>
          <label className="settings-field">
            <span>Max output tokens</span>
            <input
              type="number"
              min="1"
              max="8192"
              step="1"
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
              placeholder="Runtime default"
              disabled={status === "running"}
            />
          </label>
        </div>
        <div className="agent-run-inspector__toolbar">
          <button type="submit" disabled={!prompt.trim() || status === "running"}>
            <Play size={13} /> {status === "running" ? "Running" : "Start run"}
          </button>
          <span className={`agent-run-inspector__status is-${status}`} aria-live="polite">
            {status}
          </span>
        </div>
      </form>

      {errorMessage && (
        <p className="agent-run-inspector__error" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="agent-run-inspector__events" aria-label="Sanitized agent events">
        {events.length === 0 ? (
          <span className="agent-run-inspector__empty">No runtime events.</span>
        ) : (
          events.map((event, index) => (
            <div className="agent-run-inspector__event" key={`${event.type}-${index}`}>
              <span>{event.label}</span>
              {event.detail && <strong>{event.detail}</strong>}
            </div>
          ))
        )}
      </div>

      <div className="agent-run-inspector__history" aria-label="Durable agent run history">
        <div className="agent-run-inspector__subheading">
          <div>
            <span>History</span>
            <h4>Recent Runs</h4>
          </div>
          <p>Durable run metadata only. Prompts and provider deltas are not shown.</p>
        </div>

        <form className="agent-run-inspector__history-form" onSubmit={loadHistory}>
          <label className="settings-field">
            <span>Loom ID</span>
            <input
              value={historyLoomId}
              onChange={(event) => setHistoryLoomId(event.target.value)}
              placeholder="Load runs for a Loom"
              disabled={historyStatus === "loading"}
            />
          </label>
          <button type="submit" disabled={!historyLoomId.trim() || historyStatus === "loading"}>
            {historyStatus === "loading" ? "Loading" : "Load history"}
          </button>
        </form>

        {historyError && (
          <p className="agent-run-inspector__error" role="alert">
            {historyError}
          </p>
        )}

        <div className="agent-run-inspector__history-grid">
          <div className="agent-run-inspector__runs" aria-label="Agent run summaries">
            {historyStatus === "loaded" && runs.length === 0 ? (
              <span className="agent-run-inspector__empty">No durable Agent runs for this Loom.</span>
            ) : runs.length === 0 ? (
              <span className="agent-run-inspector__empty">Enter a Loom ID to load history.</span>
            ) : (
              runs.map((run) => (
                <button
                  type="button"
                  className={
                    selectedRun?.agentRunId === run.agentRunId
                      ? "agent-run-inspector__run is-selected"
                      : "agent-run-inspector__run"
                  }
                  key={run.agentRunId}
                  onClick={() => void selectRun(run)}
                >
                  <span>
                    <strong>{run.status}</strong>
                    <em>{shortId(run.agentRunId)}</em>
                  </span>
                  <span>{run.providerProfileId ?? "default provider"}</span>
                  <span>{run.modelId ?? "default model"}</span>
                  <span>{runUsage(run)}</span>
                </button>
              ))
            )}
          </div>

          <div className="agent-run-inspector__detail" aria-label="Selected agent run details">
            {selectedRun ? (
              <>
                <div className="agent-run-inspector__metadata">
                  <span>Run {shortId(selectedRun.agentRunId)}</span>
                  <span>Status: {selectedRun.status}</span>
                  <span>Loom: {shortId(selectedRun.loomId)}</span>
                  <span>Response: {shortId(selectedRun.responseId)}</span>
                  <span>Started: {formatDateTime(selectedRun.startedAt)}</span>
                  <span>Completed: {formatDateTime(selectedRun.completedAt)}</span>
                </div>
                {detailError && (
                  <p className="agent-run-inspector__error" role="alert">
                    {detailError}
                  </p>
                )}
                {detailStatus === "loading" ? (
                  <span className="agent-run-inspector__empty">Loading safe run details.</span>
                ) : (
                  <>
                    <div className="agent-run-inspector__detail-section">
                      <h5>Steps</h5>
                      {steps.length === 0 ? (
                        <span className="agent-run-inspector__empty">No durable steps.</span>
                      ) : (
                        steps.map((step) => (
                          <div className="agent-run-inspector__event" key={step.agentStepId}>
                            <span>{step.kind}</span>
                            <strong>
                              {step.status} · #{step.sequenceIndex}
                            </strong>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="agent-run-inspector__detail-section">
                      <h5>Events</h5>
                      {historyEvents.length === 0 ? (
                        <span className="agent-run-inspector__empty">No durable events.</span>
                      ) : (
                        historyEvents.map((historyEvent) => (
                          <div
                            className="agent-run-inspector__event"
                            key={historyEvent.agentEventId}
                          >
                            <span>
                              #{historyEvent.sequenceNumber} {historyEvent.eventType}
                            </span>
                            <strong>{payloadDetail(historyEvent.payload)}</strong>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <span className="agent-run-inspector__empty">Select a run to inspect safe durable details.</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
