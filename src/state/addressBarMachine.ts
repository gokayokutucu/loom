export type AddressBarStatus =
  | "idle"
  | "focused"
  | "typing"
  | "resolving-address"
  | "navigating"
  | "prompt-submit"
  | "feedback"
  | "error";

export interface AddressBarState {
  status: AddressBarStatus;
}

export type AddressBarEvent =
  | { type: "FOCUS" }
  | { type: "BLUR" }
  | { type: "INPUT_CHANGED" }
  | { type: "SUBMIT" }
  | { type: "ADDRESS_DETECTED" }
  | { type: "FREE_TEXT_DETECTED" }
  | { type: "RESOLVE_STARTED" }
  | { type: "RESOLVE_SUCCEEDED" }
  | { type: "RESOLVE_FAILED" }
  | { type: "NAVIGATION_STARTED" }
  | { type: "NAVIGATION_FINISHED" }
  | { type: "RESET" };

type AddressBarEventType = AddressBarEvent["type"];

export const addressBarTransitionTable = {
  idle: {
    FOCUS: "focused",
    INPUT_CHANGED: "typing",
    SUBMIT: "focused",
    ADDRESS_DETECTED: "resolving-address",
    FREE_TEXT_DETECTED: "prompt-submit",
    RESET: "idle",
  },
  focused: {
    BLUR: "idle",
    INPUT_CHANGED: "typing",
    SUBMIT: "focused",
    ADDRESS_DETECTED: "resolving-address",
    FREE_TEXT_DETECTED: "prompt-submit",
    RESOLVE_STARTED: "resolving-address",
    NAVIGATION_STARTED: "navigating",
    RESET: "idle",
  },
  typing: {
    BLUR: "idle",
    INPUT_CHANGED: "typing",
    SUBMIT: "typing",
    ADDRESS_DETECTED: "resolving-address",
    FREE_TEXT_DETECTED: "prompt-submit",
    RESOLVE_STARTED: "resolving-address",
    RESET: "idle",
  },
  "resolving-address": {
    RESOLVE_SUCCEEDED: "navigating",
    RESOLVE_FAILED: "error",
    NAVIGATION_STARTED: "navigating",
    BLUR: "idle",
    RESET: "idle",
  },
  navigating: {
    NAVIGATION_FINISHED: "idle",
    RESOLVE_FAILED: "error",
    RESET: "idle",
  },
  "prompt-submit": {
    NAVIGATION_FINISHED: "idle",
    RESOLVE_FAILED: "error",
    RESET: "idle",
  },
  feedback: {
    FOCUS: "focused",
    INPUT_CHANGED: "typing",
    BLUR: "idle",
    RESET: "idle",
  },
  error: {
    FOCUS: "focused",
    INPUT_CHANGED: "typing",
    BLUR: "idle",
    RESET: "idle",
  },
} as const satisfies Record<
  AddressBarStatus,
  Partial<Record<AddressBarEventType, AddressBarStatus>>
>;

export const initialAddressBarState: AddressBarState = {
  status: "idle",
};

export function reduceAddressBar(
  state: AddressBarState,
  event: AddressBarEvent
): AddressBarState {
  const transitions: Partial<Record<AddressBarEventType, AddressBarStatus>> =
    addressBarTransitionTable[state.status];
  const nextStatus = transitions[event.type];
  if (!nextStatus) return state;
  if (nextStatus === state.status) return state;
  return { status: nextStatus };
}

export function isAddressBarFocusedState(state: AddressBarState) {
  return (
    state.status === "focused" ||
    state.status === "typing" ||
    state.status === "resolving-address" ||
    state.status === "feedback" ||
    state.status === "error"
  );
}
