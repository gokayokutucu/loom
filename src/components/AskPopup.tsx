import { useEffect, useRef } from "react";
import { Bot, CornerDownLeft, CornerDownRight, Square, X } from "lucide-react";
import type { LoomLink, ResponseItem } from "../types";
import { cleanMarkdownDisplayText } from "../services/assistantMarkdown";
import { AssistantMarkdownContent } from "./AssistantMarkdownContent";

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
    title?: string;
    createdAt?: number;
    capsuleSnapshot?: unknown;
    selectedText?: string;
    sourceLoomId?: string;
    sourceResponseId?: string;
    sourceFragment?: LoomLink;
    activeReferences?: unknown;
    payloadReport?: unknown;
    debugTrace?: unknown;
  }>;
  error?: string;
  running?: boolean;
  sourceLoomId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function readBoolean(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringList(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function DebugRow({ label, value, testId }: { label: string; value?: string; testId?: string }) {
  if (!value) return null;
  return (
    <div className="ask-debug-row" data-testid={testId}>
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

function QuickAskDebugPanel({ trace }: { trace: unknown }) {
  const traceRecord = asRecord(trace);
  if (!traceRecord) return null;
  const diagnostics = asRecord(traceRecord.diagnostics);
  const providerSummary = asRecord(diagnostics?.providerRequestSummary);
  const answerValidation = asRecord(diagnostics?.answerValidation);
  const visibleChipLabels = readStringList(traceRecord, "visibleChipLabels");
  const diagnosticsReceived =
    readBoolean(traceRecord, "diagnosticsReceived") ??
    readBoolean(diagnostics, "diagnosticsReceived") ??
    false;
  const inputActiveReferenceLabels =
    readStringList(diagnostics, "inputActiveReferenceLabels").length > 0
      ? readStringList(diagnostics, "inputActiveReferenceLabels")
      : readStringList(traceRecord, "inputActiveReferenceLabels");
  const serviceActiveReferenceLabels = readStringList(diagnostics, "serviceActiveReferenceLabels");
  const promptSectionOrder = readStringList(diagnostics, "promptSectionOrder");
  const warnings = Array.from(
    new Set([...readStringList(traceRecord, "warnings"), ...readStringList(diagnostics, "warnings")])
  );
  const boolLabel = (value: boolean | undefined) =>
    value === undefined ? undefined : value ? "true" : "false";
  const missing = (value: string | undefined) => value ?? "missing";
  return (
    <details className="ask-debug-panel" data-testid="quick-ask-debug">
      <summary>Quick Ask debug</summary>
      <div className="ask-debug-grid">
        <DebugRow
          label="Engine"
          value={readString(traceRecord, "engineMode") ?? readString(diagnostics, "engineMode") ?? "missing"}
          testId="quick-ask-debug-engine-mode"
        />
        <DebugRow
          label="Client"
          value={readString(traceRecord, "clientKind") ?? readString(diagnostics, "clientKind") ?? "missing"}
          testId="quick-ask-debug-client-kind"
        />
        <DebugRow
          label="Request attempted"
          value={boolLabel(readBoolean(traceRecord, "requestAttempted") ?? readBoolean(diagnostics, "requestAttempted")) ?? "false"}
          testId="quick-ask-debug-request-attempted"
        />
        <DebugRow
          label="Endpoint"
          value={readString(traceRecord, "endpoint") ?? readString(diagnostics, "endpoint") ?? "missing"}
          testId="quick-ask-debug-endpoint"
        />
        <DebugRow
          label="HTTP status"
          value={
            readNumber(traceRecord, "httpStatus")?.toString() ??
            readNumber(diagnostics, "httpStatus")?.toString() ??
            "missing"
          }
          testId="quick-ask-debug-http-status"
        />
        <DebugRow
          label="Response parse"
          value={readString(traceRecord, "responseParseStatus") ?? readString(diagnostics, "responseParseStatus") ?? "missing"}
          testId="quick-ask-debug-response-parse-status"
        />
        <DebugRow
          label="Diagnostics received"
          value={boolLabel(diagnosticsReceived)}
          testId="quick-ask-debug-diagnostics-received"
        />
        <DebugRow
          label="Transport error"
          value={readString(traceRecord, "transportErrorKind") ?? readString(traceRecord, "errorKind") ?? "none"}
          testId="quick-ask-debug-transport-error"
        />
        <DebugRow
          label="Trace id"
          value={readString(diagnostics, "traceId") ?? readString(traceRecord, "traceId")}
          testId="quick-ask-debug-trace-id"
        />
        <DebugRow
          label="Visible chips"
          value={visibleChipLabels.join(", ")}
          testId="quick-ask-debug-visible-chips"
        />
        <DebugRow
          label="User question"
          value={readString(traceRecord, "userQuestion")}
          testId="quick-ask-debug-question"
        />
        <DebugRow
          label="Selected fragment"
          value={readString(traceRecord, "selectedFragmentPreview")}
        />
        <DebugRow label="Source title" value={readString(traceRecord, "sourceTitle")} />
        <DebugRow
          label="Focus subject"
          value={missing(readString(diagnostics, "focusSubject"))}
          testId="quick-ask-debug-focus-subject"
        />
        <DebugRow
          label="Original focus"
          value={missing(readString(diagnostics, "originalFocusSubject"))}
          testId="quick-ask-debug-original-focus-subject"
        />
        <DebugRow
          label="Normalized focus"
          value={missing(readString(diagnostics, "normalizedFocusSubject"))}
          testId="quick-ask-debug-normalized-focus-subject"
        />
        <DebugRow
          label="Focus source"
          value={missing(readString(diagnostics, "focusSubjectSource"))}
        />
        <DebugRow
          label="Turn"
          value={readNumber(diagnostics, "turnIndex")?.toString()}
        />
        <DebugRow
          label="Previous answer term"
          value={readString(diagnostics, "previousAnswerTermMatched")}
        />
        <DebugRow
          label="Active chip primary"
          value={boolLabel(readBoolean(diagnostics, "activeChipUsedAsPrimary"))}
        />
        <DebugRow
          label="Active chip background"
          value={boolLabel(readBoolean(diagnostics, "activeChipUsedAsBackground"))}
        />
        <DebugRow
          label="Seed context"
          value={readStringList(diagnostics, "seedContextLabels").join(", ")}
          testId="quick-ask-debug-seed-context"
        />
        <DebugRow
          label="Seed mode"
          value={readString(diagnostics, "seedContextMode")}
          testId="quick-ask-debug-seed-mode"
        />
        <DebugRow
          label="Primary context"
          value={readString(diagnostics, "currentTurnPrimaryContext")}
          testId="quick-ask-debug-primary-context"
        />
        <DebugRow
          label="Follow-up intent"
          value={readString(diagnostics, "followUpIntent")}
          testId="quick-ask-debug-follow-up-intent"
        />
        <DebugRow label="Intent" value={missing(readString(diagnostics, "resolvedIntent"))} />
        <DebugRow
          label="Requested topic"
          value={missing(readString(diagnostics, "requestedTopic"))}
          testId="quick-ask-debug-requested-topic"
        />
        <DebugRow
          label="Composed task"
          value={missing(readString(diagnostics, "composedTask"))}
          testId="quick-ask-debug-composed-task"
        />
        <DebugRow
          label="Normalized question"
          value={readString(diagnostics, "normalizedComposedQuestion")}
          testId="quick-ask-debug-normalized-composed-question"
        />
        <DebugRow label="Language" value={readString(diagnostics, "language")} />
        <DebugRow
          label="Language contamination"
          value={boolLabel(readBoolean(diagnostics, "languageContaminationDetected"))}
        />
        <DebugRow
          label="Stale chip override"
          value={boolLabel(readBoolean(diagnostics, "staleChipOverrideDetected"))}
        />
        <DebugRow
          label="Prompt order"
          value={promptSectionOrder.length > 0 ? promptSectionOrder.join(" > ") : "missing"}
          testId="quick-ask-debug-prompt-order"
        />
        <DebugRow
          label="Input active refs"
          value={inputActiveReferenceLabels.join(", ")}
          testId="quick-ask-debug-input-active-references"
        />
        <DebugRow
          label="Service active refs"
          value={serviceActiveReferenceLabels.length > 0 ? serviceActiveReferenceLabels.join(", ") : "missing"}
          testId="quick-ask-debug-service-active-references"
        />
        <DebugRow
          label="Previous Ask turns"
          value={String(
            readNumber(diagnostics, "previousAskTurnCount") ??
              readNumber(traceRecord, "previousAskTurnCount") ??
              0
          )}
        />
        <DebugRow label="HTTP status" value={readNumber(traceRecord, "httpStatus")?.toString()} />
        <DebugRow label="Error kind" value={readString(traceRecord, "errorKind")} />
        <DebugRow
          label="Provider summary"
          value={[
            readString(providerSummary, "focusSubject")
              ? `focus=${readString(providerSummary, "focusSubject")}`
              : undefined,
            readString(providerSummary, "requestedTopic")
              ? `topic=${readString(providerSummary, "requestedTopic")}`
              : undefined,
            readString(providerSummary, "composedTaskPreview")
              ? `task=${readString(providerSummary, "composedTaskPreview")}`
              : undefined,
            boolLabel(readBoolean(providerSummary, "focusSubjectBeforeSource"))
              ? `focusBeforeSource=${boolLabel(readBoolean(providerSummary, "focusSubjectBeforeSource"))}`
              : undefined,
          ]
            .filter(Boolean)
            .join(" · ") || "missing"}
          testId="quick-ask-debug-provider-summary"
        />
        <DebugRow
          label="Answer validation"
          value={[
            `includesFocusSubject=${boolLabel(readBoolean(answerValidation, "includesFocusSubject")) ?? "n/a"}`,
            `includesRequestedTopic=${boolLabel(readBoolean(answerValidation, "includesRequestedTopic")) ?? "n/a"}`,
            `genericSourceOnlyDetected=${boolLabel(readBoolean(answerValidation, "genericSourceOnlyDetected")) ?? "n/a"}`,
            `startsWithFocusSubjectOrDefinition=${boolLabel(readBoolean(answerValidation, "startsWithFocusSubjectOrDefinition")) ?? "n/a"}`,
            `languageContaminationDetected=${boolLabel(readBoolean(answerValidation, "languageContaminationDetected")) ?? "n/a"}`,
            `staleChipOverrideDetected=${boolLabel(readBoolean(answerValidation, "staleChipOverrideDetected")) ?? "n/a"}`,
            `repeatsPreviousAnswer=${boolLabel(readBoolean(answerValidation, "repeatsPreviousAnswer")) ?? "n/a"}`,
            `followsUpOnPreviousTurn=${boolLabel(readBoolean(answerValidation, "followsUpOnPreviousTurn")) ?? "n/a"}`,
            `seedChipRenderedAsCurrentTurn=${boolLabel(readBoolean(answerValidation, "seedChipRenderedAsCurrentTurn")) ?? "n/a"}`,
            `answerAddsNewInformation=${boolLabel(readBoolean(answerValidation, "answerAddsNewInformation")) ?? "n/a"}`,
            `validationPassed=${boolLabel(readBoolean(answerValidation, "validationPassed")) ?? "n/a"}`,
            `validationFailedFirstAttempt=${boolLabel(readBoolean(answerValidation, "validationFailedFirstAttempt")) ?? "n/a"}`,
            `retryAttempted=${boolLabel(readBoolean(answerValidation, "retryAttempted")) ?? "n/a"}`,
            `retrySucceeded=${boolLabel(readBoolean(answerValidation, "retrySucceeded")) ?? "n/a"}`,
            `finalAnswerSource=${readString(answerValidation, "finalAnswerSource") ?? "n/a"}`,
            `failureReasons=${readStringList(answerValidation, "failureReasons").join(", ") || "none"}`,
          ].join(" · ")}
          testId="quick-ask-debug-answer-validation"
        />
        <DebugRow
          label="Warnings"
          value={warnings.length > 0 ? warnings.join(", ") : "none"}
          testId="quick-ask-debug-warnings"
        />
      </div>
    </details>
  );
}

function displayQuickAskAnswer(answer: string) {
  return answer
    .replace(/^\s*(Focus subject|Answer focus|Current task|Composed task|Answer requirements):\s*/i, "")
    .trimStart();
}

export function AskPopup({
  state,
  onUpdate,
  onClose,
  onLoom,
  onSubmit,
  onStop,
  showDebug,
  submitBlockedReason,
}: {
  state: AskPopupState;
  onUpdate: (state: AskPopupState) => void;
  onClose: () => void;
  onLoom: () => void;
  onSubmit: () => void;
  onStop: () => void;
  showDebug: boolean;
  submitBlockedReason?: string | null;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const answerListRef = useRef<HTMLDivElement | null>(null);
  const lastExchangeAnswer = state.exchanges?.[state.exchanges.length - 1]?.answer;
  const selectedQuoteText =
    state.sourceSelectedText?.trim() ||
    (state.contextKind === "fragment" ? state.selectedText.trim() : "");

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
  const latestDebugTrace = exchanges[exchanges.length - 1]?.debugTrace;
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
            <h2 id="ask-title">{cleanMarkdownDisplayText(state.response.title) || state.response.title}</h2>
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
        {!hasAnswer && selectedQuoteText && (
          <div
            className="ask-selected-reference-chip"
            data-testid="ask-selected-fragment"
            aria-label="Selected text"
            title={selectedQuoteText}
          >
            <CornerDownRight size={14} />
            <span>{selectedQuoteText}</span>
          </div>
        )}
        {hasAnswer && (
          <div className="ask-answer-list" data-testid="ask-answer-list" ref={answerListRef}>
            {exchanges.map((exchange, index) => {
              const exchangeQuote =
                index === 0 ? exchange.selectedText?.trim() || selectedQuoteText : "";
              const displayAnswer = displayQuickAskAnswer(exchange.answer);
              const isPendingAnswer =
                Boolean(state.running) &&
                index === exchanges.length - 1 &&
                !displayAnswer.trim();
              return (
                <div
                  className="ask-exchange"
                  data-testid="ask-answer"
                  key={`${exchange.question}-${index}`}
                >
                  {exchangeQuote && (
                    <div
                      className="ask-exchange-reference"
                      data-testid="ask-selected-fragment"
                      aria-label="Selected text"
                      title={exchangeQuote}
                    >
                      <CornerDownRight size={14} />
                      <span>{exchangeQuote}</span>
                    </div>
                  )}
                  <div className="ask-exchange-question">
                    <p>{exchange.question}</p>
                  </div>
                  <div
                    className={
                      isPendingAnswer
                        ? "ask-exchange-answer ask-exchange-answer--pending"
                        : "ask-exchange-answer"
                    }
                    aria-live={isPendingAnswer ? "polite" : undefined}
                  >
                    <Bot size={15} />
                    <div className="ask-exchange-answer-markdown">
                      <AssistantMarkdownContent markdown={displayAnswer} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {showDebug && latestDebugTrace !== undefined && latestDebugTrace !== null && (
          <QuickAskDebugPanel trace={latestDebugTrace} />
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
        {submitBlockedReason && !state.running && (
          <p className="ask-submit-blocked" data-testid="quick-ask-submit-blocked">
            {submitBlockedReason}
          </p>
        )}
        <div className="ask-actions">
          <button tabIndex={0} onClick={onLoom} disabled={!hasAnswer || state.running}>
            Convert to Weft
          </button>
          <button
          className="primary"
          tabIndex={0}
          onClick={state.running ? onStop : onSubmit}
          disabled={(!state.running && !state.question.trim()) || Boolean(!state.running && submitBlockedReason)}
          aria-label={state.running ? "Stop Ask response" : "Ask"}
          title={!state.running && submitBlockedReason ? submitBlockedReason : undefined}
          data-testid={!state.running && submitBlockedReason ? "quick-ask-blocked-button" : undefined}
        >
          {state.running ? <Square size={13} fill="currentColor" /> : <CornerDownLeft size={15} />}
          {state.running ? "Asking..." : "Ask"}
        </button>
        </div>
      </div>
    </div>
  );
}
