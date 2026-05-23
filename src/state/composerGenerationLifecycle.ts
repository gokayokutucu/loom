import type { EngineResponseEvent } from "../engine/LoomEngineTypes";

export type ComposerGenerationStateName =
  | "idle"
  | "draft-ready"
  | "submitting"
  | "placeholder-created"
  | "service-accepted"
  | "streaming-thinking"
  | "streaming-answer"
  | "completed"
  | "truncated"
  | "cancelled"
  | "error";

export type ComposerGenerationEventName =
  | "SUBMIT"
  | "PLACEHOLDER_CREATED"
  | "SERVICE_ACCEPTED"
  | "THINKING_STARTED"
  | "THINKING_PROGRESS"
  | "ANSWER_DELTA"
  | "RESPONSE_COMPLETED"
  | "RESPONSE_TRUNCATED"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "ERROR"
  | "RETRY";

export interface ComposerGenerationLifecycleMap {
  states: readonly ComposerGenerationStateName[];
  events: readonly ComposerGenerationEventName[];
  notes: {
    draft: string;
    service: string;
    thinking: string;
    temporaryWeft: string;
  };
}

export const composerGenerationLifecycleMap: ComposerGenerationLifecycleMap = {
  states: [
    "idle",
    "draft-ready",
    "submitting",
    "placeholder-created",
    "service-accepted",
    "streaming-thinking",
    "streaming-answer",
    "completed",
    "truncated",
    "cancelled",
    "error",
  ],
  events: [
    "SUBMIT",
    "PLACEHOLDER_CREATED",
    "SERVICE_ACCEPTED",
    "THINKING_STARTED",
    "THINKING_PROGRESS",
    "ANSWER_DELTA",
    "RESPONSE_COMPLETED",
    "RESPONSE_TRUNCATED",
    "CANCEL_REQUESTED",
    "CANCELLED",
    "ERROR",
    "RETRY",
  ],
  notes: {
    draft:
      "Current generation clears the submitted draft after the local placeholder is created; accepted service errors render into the local response mirror instead of restoring the draft.",
    service:
      "Current service-backed Main composer treats user_message_created, assistant_placeholder_created, content_delta, completion, truncation, cancellation, and response_error as accepted service stream events.",
    thinking:
      "Current UI stores safe thinking status metadata such as elapsed duration, not raw model thinking text.",
    temporaryWeft:
      "Temporary Weft first prompt promotes the Weft before generation continues against the persisted target Loom.",
  },
} as const;

export type ComposerGenerationUiEvent =
  | { type: "SUBMIT" }
  | {
      type: "PLACEHOLDER_CREATED";
      responseId: string;
      loomId?: string;
      workflowRunId?: string;
      loomTitle?: string;
    }
  | {
      type: "SERVICE_ACCEPTED";
      responseId?: string;
      loomId?: string;
      workflowRunId?: string;
      loomTitle?: string;
    }
  | { type: "THINKING_STARTED"; durationMs?: number }
  | { type: "THINKING_PROGRESS"; durationMs?: number }
  | { type: "ANSWER_DELTA"; responseId: string; delta: string }
  | { type: "RESPONSE_COMPLETED"; responseId: string; doneReason?: string; loomTitle?: string }
  | { type: "RESPONSE_TRUNCATED"; responseId: string; doneReason?: string; loomTitle?: string }
  | { type: "CANCEL_REQUESTED" }
  | { type: "CANCELLED"; responseId?: string; message?: string; workflowRunId?: string }
  | { type: "ERROR"; responseId?: string; message: string; code?: string; workflowRunId?: string }
  | { type: "RETRY" };

export interface ComposerGenerationSnapshot {
  state: ComposerGenerationStateName;
  serviceAccepted: boolean;
  responseId?: string;
  userResponseId?: string;
  workflowRunId?: string;
  answerText: string;
  thinkingStarted: boolean;
  elapsedThinkingSeconds?: number;
  doneReason?: string;
  errorMessage?: string;
  cancelledMessage?: string;
  truncated: boolean;
}

export function createComposerGenerationSnapshot(
  draftReady = false
): ComposerGenerationSnapshot {
  return {
    state: draftReady ? "draft-ready" : "idle",
    serviceAccepted: false,
    answerText: "",
    thinkingStarted: false,
    truncated: false,
  };
}

export function normalizeComposerGenerationEvent(
  event: EngineResponseEvent
): ComposerGenerationUiEvent | null {
  switch (event.type) {
    case "user_message_created":
      return {
        type: "SERVICE_ACCEPTED",
        loomId: event.payload.loomId,
        responseId: event.payload.responseId,
        workflowRunId: event.payload.workflowRunId,
        loomTitle: event.payload.loomTitle,
      };
    case "assistant_placeholder_created":
      return {
        type: "PLACEHOLDER_CREATED",
        loomId: event.payload.loomId,
        responseId: event.payload.responseId,
        workflowRunId: event.payload.workflowRunId,
        loomTitle: event.payload.loomTitle,
      };
    case "thinking_status":
      return {
        type: event.payload.status === "started" ? "THINKING_STARTED" : "THINKING_PROGRESS",
        durationMs: event.payload.durationMs,
      };
    case "content_delta":
      return {
        type: "ANSWER_DELTA",
        responseId: event.payload.responseId,
        delta: event.payload.delta,
      };
    case "response_completed":
      return {
        type: "RESPONSE_COMPLETED",
        responseId: event.payload.responseId,
        doneReason: event.payload.doneReason,
        loomTitle: event.payload.loomTitle,
      };
    case "response_truncated":
      return {
        type: "RESPONSE_TRUNCATED",
        responseId: event.payload.responseId,
        doneReason: event.payload.doneReason,
        loomTitle: event.payload.loomTitle,
      };
    case "response_cancelled":
      return {
        type: "CANCELLED",
        responseId: event.payload.responseId,
        message: event.payload.message,
        workflowRunId: event.payload.workflowRunId,
      };
    case "response_error":
      return {
        type: "ERROR",
        responseId: event.payload.responseId,
        message: event.payload.message,
        code: event.payload.code,
        workflowRunId: event.payload.workflowRunId,
      };
    case "status":
    case "answer_plan_ready":
    case "context_ready":
      return null;
  }
}

export function applyComposerGenerationEvent(
  snapshot: ComposerGenerationSnapshot,
  event: ComposerGenerationUiEvent
): ComposerGenerationSnapshot {
  switch (event.type) {
    case "SUBMIT":
      return { ...snapshot, state: "submitting" };
    case "PLACEHOLDER_CREATED":
      return {
        ...snapshot,
        state: "placeholder-created",
        serviceAccepted: true,
        responseId: event.responseId,
        workflowRunId: event.workflowRunId ?? snapshot.workflowRunId,
      };
    case "SERVICE_ACCEPTED":
      return {
        ...snapshot,
        state: "service-accepted",
        serviceAccepted: true,
        userResponseId: event.responseId ?? snapshot.userResponseId,
        workflowRunId: event.workflowRunId ?? snapshot.workflowRunId,
      };
    case "THINKING_STARTED":
    case "THINKING_PROGRESS":
      return {
        ...snapshot,
        state: "streaming-thinking",
        thinkingStarted: true,
        elapsedThinkingSeconds:
          event.durationMs !== undefined
            ? Math.round(event.durationMs / 1000)
            : snapshot.elapsedThinkingSeconds,
      };
    case "ANSWER_DELTA":
      return {
        ...snapshot,
        state: "streaming-answer",
        serviceAccepted: true,
        responseId: event.responseId,
        answerText: `${snapshot.answerText}${event.delta}`,
      };
    case "RESPONSE_COMPLETED":
      return {
        ...snapshot,
        state: "completed",
        responseId: event.responseId,
        doneReason: event.doneReason,
        truncated: false,
      };
    case "RESPONSE_TRUNCATED":
      return {
        ...snapshot,
        state: "truncated",
        responseId: event.responseId,
        doneReason: event.doneReason,
        truncated: true,
      };
    case "CANCEL_REQUESTED":
      return snapshot;
    case "CANCELLED":
      return {
        ...snapshot,
        state: "cancelled",
        serviceAccepted: true,
        responseId: event.responseId ?? snapshot.responseId,
        workflowRunId: event.workflowRunId ?? snapshot.workflowRunId,
        cancelledMessage: event.message,
      };
    case "ERROR":
      return {
        ...snapshot,
        state: "error",
        serviceAccepted: true,
        responseId: event.responseId ?? snapshot.responseId,
        workflowRunId: event.workflowRunId ?? snapshot.workflowRunId,
        errorMessage: event.message,
      };
    case "RETRY":
      return createComposerGenerationSnapshot(true);
  }
}

export function applyEngineResponseEvent(
  snapshot: ComposerGenerationSnapshot,
  event: EngineResponseEvent
): ComposerGenerationSnapshot {
  const normalized = normalizeComposerGenerationEvent(event);
  return normalized ? applyComposerGenerationEvent(snapshot, normalized) : snapshot;
}
