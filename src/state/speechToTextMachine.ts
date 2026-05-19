export type SpeechToTextStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "stopping"
  | "transcribing"
  | "completed"
  | "error"
  | "cancelled";

export interface SpeechToTextState {
  status: SpeechToTextStatus;
  error: string | null;
}

export type SpeechToTextEvent =
  | { type: "START_REQUESTED" }
  | { type: "PERMISSION_GRANTED" }
  | { type: "PERMISSION_DENIED"; error: string }
  | { type: "RECORDER_READY" }
  | { type: "RECORDING_STARTED" }
  | { type: "STOP_REQUESTED" }
  | { type: "AUDIO_READY" }
  | { type: "TRANSCRIBE_STARTED" }
  | { type: "TRANSCRIBE_SUCCEEDED" }
  | { type: "TRANSCRIBE_FAILED"; error: string }
  | { type: "CANCEL_REQUESTED" }
  | { type: "CLEANUP_DONE" }
  | { type: "RESET" };

type SpeechToTextEventType = SpeechToTextEvent["type"];

export const speechToTextTransitionTable = {
  idle: {
    START_REQUESTED: "requesting-permission",
    TRANSCRIBE_FAILED: "error",
    RESET: "idle",
  },
  "requesting-permission": {
    PERMISSION_GRANTED: "requesting-permission",
    PERMISSION_DENIED: "error",
    RECORDER_READY: "requesting-permission",
    RECORDING_STARTED: "recording",
    TRANSCRIBE_FAILED: "error",
    CANCEL_REQUESTED: "cancelled",
    RESET: "idle",
  },
  recording: {
    STOP_REQUESTED: "stopping",
    TRANSCRIBE_FAILED: "error",
    CANCEL_REQUESTED: "cancelled",
    RESET: "idle",
  },
  stopping: {
    AUDIO_READY: "transcribing",
    TRANSCRIBE_STARTED: "transcribing",
    TRANSCRIBE_FAILED: "error",
    CANCEL_REQUESTED: "cancelled",
    CLEANUP_DONE: "idle",
    RESET: "idle",
  },
  transcribing: {
    TRANSCRIBE_SUCCEEDED: "completed",
    TRANSCRIBE_FAILED: "error",
    CANCEL_REQUESTED: "cancelled",
    RESET: "idle",
  },
  completed: {
    CLEANUP_DONE: "idle",
    RESET: "idle",
  },
  error: {
    RESET: "idle",
    CLEANUP_DONE: "idle",
  },
  cancelled: {
    CLEANUP_DONE: "idle",
    RESET: "idle",
  },
} as const satisfies Record<
  SpeechToTextStatus,
  Partial<Record<SpeechToTextEventType, SpeechToTextStatus>>
>;

export const initialSpeechToTextState: SpeechToTextState = {
  status: "idle",
  error: null,
};

export function reduceSpeechToText(
  state: SpeechToTextState,
  event: SpeechToTextEvent
): SpeechToTextState {
  const transitions: Partial<Record<SpeechToTextEventType, SpeechToTextStatus>> =
    speechToTextTransitionTable[state.status];
  const nextStatus = transitions[event.type];
  if (!nextStatus) return state;
  if (nextStatus === state.status && !eventHasError(event)) return state;
  return createSpeechToTextState(nextStatus, event);
}

export function createSpeechToTextState(
  status: SpeechToTextStatus,
  event?: SpeechToTextEvent
): SpeechToTextState {
  if (eventHasError(event)) {
    return { status, error: event.error };
  }
  return { status, error: null };
}

function eventHasError(
  event: SpeechToTextEvent | undefined
): event is Extract<
  SpeechToTextEvent,
  { type: "PERMISSION_DENIED" | "TRANSCRIBE_FAILED" }
> {
  return event?.type === "PERMISSION_DENIED" || event?.type === "TRANSCRIBE_FAILED";
}
