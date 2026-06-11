import { useEffect, useRef, useState, type FormEvent } from "react";
import { FlaskConical, Play } from "lucide-react";
import {
  AgentInspectorStreamError,
  streamExperimentalAgentRun,
  type AgentInspectorEventRow,
  type AgentInspectorTerminalStatus,
} from "../services/agentRuntimeInspector";

type InspectorStatus = "idle" | "running" | AgentInspectorTerminalStatus | "error";

export function AgentRunInspector({ enabled }: { enabled: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [events, setEvents] = useState<AgentInspectorEventRow[]>([]);
  const [status, setStatus] = useState<InspectorStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
    </section>
  );
}
