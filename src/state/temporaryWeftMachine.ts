export type TemporaryWeftLifecycleStatus =
  | "absent"
  | "temporary"
  | "active"
  | "promoting"
  | "persisted"
  | "discarded"
  | "promotion-error";

export type TemporaryWeftLifecycleState =
  | { status: "absent" }
  | { status: "temporary" }
  | { status: "active" }
  | { status: "promoting" }
  | { status: "persisted"; persistedWeftId?: string }
  | { status: "discarded" }
  | { status: "promotion-error"; errorMessage?: string };

export type TemporaryWeftLifecycleEvent =
  | { type: "OPEN_TEMP" }
  | { type: "FOCUS_TEMP" }
  | { type: "SUBMIT_FIRST_PROMPT" }
  | { type: "PROMOTION_STARTED" }
  | { type: "PROMOTION_SUCCEEDED"; persistedWeftId?: string }
  | { type: "PROMOTION_FAILED"; errorMessage?: string }
  | { type: "DISCARD_TEMP" }
  | { type: "CLOSE_SPLIT" }
  | { type: "RESET" };

type TemporaryWeftLifecycleEventType = TemporaryWeftLifecycleEvent["type"];

export const temporaryWeftTransitionTable = {
  absent: {
    OPEN_TEMP: "temporary",
    RESET: "absent",
  },
  temporary: {
    FOCUS_TEMP: "active",
    SUBMIT_FIRST_PROMPT: "promoting",
    PROMOTION_STARTED: "promoting",
    DISCARD_TEMP: "discarded",
    CLOSE_SPLIT: "discarded",
    RESET: "absent",
  },
  active: {
    FOCUS_TEMP: "active",
    SUBMIT_FIRST_PROMPT: "promoting",
    PROMOTION_STARTED: "promoting",
    DISCARD_TEMP: "discarded",
    CLOSE_SPLIT: "discarded",
    RESET: "absent",
  },
  promoting: {
    PROMOTION_STARTED: "promoting",
    PROMOTION_SUCCEEDED: "persisted",
    PROMOTION_FAILED: "promotion-error",
    RESET: "absent",
  },
  persisted: {
    FOCUS_TEMP: "persisted",
    CLOSE_SPLIT: "persisted",
    RESET: "absent",
  },
  discarded: {
    RESET: "absent",
  },
  "promotion-error": {
    SUBMIT_FIRST_PROMPT: "promoting",
    PROMOTION_STARTED: "promoting",
    DISCARD_TEMP: "discarded",
    CLOSE_SPLIT: "discarded",
    RESET: "absent",
  },
} as const satisfies Record<
  TemporaryWeftLifecycleStatus,
  Partial<Record<TemporaryWeftLifecycleEventType, TemporaryWeftLifecycleStatus>>
>;

export function reduceTemporaryWeftLifecycle(
  state: TemporaryWeftLifecycleState,
  event: TemporaryWeftLifecycleEvent
): TemporaryWeftLifecycleState {
  const transitions: Partial<
    Record<TemporaryWeftLifecycleEventType, TemporaryWeftLifecycleStatus>
  > = temporaryWeftTransitionTable[state.status];
  const nextStatus = transitions[event.type];
  if (!nextStatus) return state;
  if (nextStatus === state.status) return state;
  return createTemporaryWeftLifecycleState(nextStatus, event);
}

export function transitionTemporaryWeftStatus(
  status: TemporaryWeftLifecycleStatus,
  event: TemporaryWeftLifecycleEvent
): TemporaryWeftLifecycleStatus {
  return reduceTemporaryWeftLifecycle({ status } as TemporaryWeftLifecycleState, event).status;
}

export function createTemporaryWeftLifecycleState(
  status: TemporaryWeftLifecycleStatus,
  event?: TemporaryWeftLifecycleEvent
): TemporaryWeftLifecycleState {
  if (status === "persisted") {
    return {
      status,
      persistedWeftId:
        event?.type === "PROMOTION_SUCCEEDED" ? event.persistedWeftId : undefined,
    };
  }
  if (status === "promotion-error") {
    return {
      status,
      errorMessage: event?.type === "PROMOTION_FAILED" ? event.errorMessage : undefined,
    };
  }
  return { status };
}
