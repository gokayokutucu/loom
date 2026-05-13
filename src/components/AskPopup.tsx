import { useEffect, useRef } from "react";
import { Bot, CornerDownLeft, Square, X } from "lucide-react";
import type { LoomLink, ResponseItem } from "../types";

export interface AskPopupState {
  sessionId?: string;
  response: ResponseItem;
  selectedText: string;
  sourceSelectedText?: string;
  sourceResponseId?: string;
  sourceFragment?: LoomLink;
  contextKind?: "response" | "fragment";
  contextPreview?: string;
  contextModeLabel?: string;
  question: string;
  answered: boolean;
  answer?: string;
  exchanges?: Array<{
    id?: string;
    question: string;
    answer: string;
    createdAt?: number;
    capsuleSnapshot?: unknown;
    selectedText?: string;
    sourceLoomId?: string;
    sourceResponseId?: string;
    sourceFragment?: LoomLink;
    payloadReport?: unknown;
  }>;
  error?: string;
  running?: boolean;
  sourceLoomId?: string;
}

export function AskPopup({
  state,
  onUpdate,
  onClose,
  onLoom,
  onSubmit,
  onStop,
}: {
  state: AskPopupState;
  onUpdate: (state: AskPopupState) => void;
  onClose: () => void;
  onLoom: () => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const answerListRef = useRef<HTMLDivElement | null>(null);
  const lastExchangeAnswer = state.exchanges?.[state.exchanges.length - 1]?.answer;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [state.running, state.exchanges?.length, lastExchangeAnswer]);

  useEffect(() => {
    const answerList = answerListRef.current;
    if (!answerList) return;
    answerList.scrollTo({
      top: answerList.scrollHeight,
      behavior: "smooth",
    });
  }, [state.exchanges?.length, state.answer, lastExchangeAnswer]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const exchanges =
    state.exchanges ??
    (state.answered && state.answer
      ? [{ question: state.question, answer: state.answer }]
      : []);
  const hasAnswer = exchanges.length > 0;
  const contextLabel = state.contextKind === "fragment" ? "Context Fragment" : "Context Response";

  return (
    <div className="ask-modal-backdrop">
      <div
        className="ask-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
      >
        <div className="ask-header">
          <div>
            <span>Ask</span>
            <h2 id="ask-title">{state.response.title}</h2>
          </div>
          <button
            className="icon-button"
            tabIndex={0}
            onClick={onClose}
            aria-label="Close Ask"
          >
            <X size={16} />
          </button>
        </div>
        <div className="ask-context" data-testid="ask-context">
          <span>{contextLabel}</span>
          {state.contextModeLabel && <em>{state.contextModeLabel}</em>}
          <blockquote>{state.contextPreview ?? state.selectedText}</blockquote>
        </div>
        {hasAnswer && (
          <div className="ask-answer-list" data-testid="ask-answer-list" ref={answerListRef}>
            {exchanges.map((exchange, index) => (
              <div
                className="ask-exchange"
                data-testid="ask-answer"
                key={`${exchange.question}-${index}`}
              >
                <div className="ask-exchange-question">
                  <p>{exchange.question}</p>
                </div>
                <div className="ask-exchange-answer">
                  <Bot size={15} />
                  <p>{exchange.answer}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={state.question}
          onChange={(event) => onUpdate({ ...state, question: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            if (state.running) return;
            event.preventDefault();
            onSubmit();
          }
          }}
          placeholder="Ask a focused follow-up about this selection..."
          aria-label="Ask question"
          tabIndex={0}
        />
        {state.error && <p className="ask-error">{state.error}</p>}
        <div className="ask-actions">
          <button tabIndex={0} onClick={onLoom} disabled={!hasAnswer || state.running}>
            Convert to Weft
          </button>
          <button
          className="primary"
          tabIndex={0}
          onClick={state.running ? onStop : onSubmit}
          disabled={!state.running && !state.question.trim()}
          aria-label={state.running ? "Stop Ask response" : "Ask"}
        >
          {state.running ? <Square size={13} fill="currentColor" /> : <CornerDownLeft size={15} />}
          {state.running ? "Asking..." : "Ask"}
        </button>
        </div>
      </div>
    </div>
  );
}
