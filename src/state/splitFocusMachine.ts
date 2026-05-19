export type SplitFocusStableStatus =
  | "full-origin"
  | "split-origin-active"
  | "split-persisted-weft-active"
  | "split-temporary-weft-active";

export type SplitFocusStatus =
  | SplitFocusStableStatus
  | "graph-context-switching"
  | "split-closing";

export type SplitFocusSurface = "origin" | "persisted-weft" | "temporary-weft";
export type SplitFocusAddressableSurface = "origin" | "persisted-weft";
export type SplitFocusWeftKind = "persisted" | "temporary";

export type SplitFocusState =
  | {
      status: "full-origin";
      activeSurface: "origin";
      addressableSurface: "origin";
    }
  | {
      status: "split-origin-active";
      activeSurface: "origin";
      addressableSurface: "origin";
    }
  | {
      status: "split-persisted-weft-active";
      activeSurface: "persisted-weft";
      addressableSurface: "persisted-weft";
    }
  | {
      status: "split-temporary-weft-active";
      activeSurface: "temporary-weft";
      addressableSurface: "origin";
    }
  | {
      status: "graph-context-switching";
      activeSurface: SplitFocusSurface;
      addressableSurface: SplitFocusAddressableSurface;
      previousStatus: SplitFocusStableStatus;
    }
  | {
      status: "split-closing";
      activeSurface: SplitFocusSurface;
      addressableSurface: SplitFocusAddressableSurface;
      previousStatus: SplitFocusStableStatus;
    };

export type SplitFocusEvent =
  | { type: "ORIGIN_INTERACTED" }
  | { type: "PERSISTED_WEFT_INTERACTED" }
  | { type: "TEMP_WEFT_INTERACTED" }
  | { type: "TEMP_WEFT_PROMOTED" }
  | { type: "SPLIT_OPENED"; weftKind: SplitFocusWeftKind }
  | { type: "SPLIT_CLOSED" }
  | { type: "GRAPH_CONTEXT_SWITCHED" }
  | { type: "NAVIGATED_FULL" };

type SplitFocusEventType = SplitFocusEvent["type"];

export const splitFocusTransitionTable = {
  "full-origin": {
    ORIGIN_INTERACTED: "full-origin",
    PERSISTED_WEFT_INTERACTED: "split-persisted-weft-active",
    TEMP_WEFT_INTERACTED: "split-temporary-weft-active",
    SPLIT_OPENED: "split-persisted-weft-active",
    NAVIGATED_FULL: "full-origin",
  },
  "split-origin-active": {
    ORIGIN_INTERACTED: "split-origin-active",
    PERSISTED_WEFT_INTERACTED: "split-persisted-weft-active",
    TEMP_WEFT_INTERACTED: "split-temporary-weft-active",
    SPLIT_CLOSED: "split-closing",
    GRAPH_CONTEXT_SWITCHED: "graph-context-switching",
    NAVIGATED_FULL: "full-origin",
  },
  "split-persisted-weft-active": {
    ORIGIN_INTERACTED: "split-origin-active",
    PERSISTED_WEFT_INTERACTED: "split-persisted-weft-active",
    TEMP_WEFT_INTERACTED: "split-temporary-weft-active",
    SPLIT_CLOSED: "split-closing",
    GRAPH_CONTEXT_SWITCHED: "graph-context-switching",
    NAVIGATED_FULL: "full-origin",
  },
  "split-temporary-weft-active": {
    ORIGIN_INTERACTED: "split-origin-active",
    PERSISTED_WEFT_INTERACTED: "split-persisted-weft-active",
    TEMP_WEFT_INTERACTED: "split-temporary-weft-active",
    TEMP_WEFT_PROMOTED: "split-persisted-weft-active",
    SPLIT_CLOSED: "split-closing",
    GRAPH_CONTEXT_SWITCHED: "graph-context-switching",
    NAVIGATED_FULL: "full-origin",
  },
  "graph-context-switching": {
    ORIGIN_INTERACTED: "split-origin-active",
    PERSISTED_WEFT_INTERACTED: "split-persisted-weft-active",
    TEMP_WEFT_INTERACTED: "split-temporary-weft-active",
    GRAPH_CONTEXT_SWITCHED: "split-origin-active",
    NAVIGATED_FULL: "full-origin",
  },
  "split-closing": {
    ORIGIN_INTERACTED: "split-origin-active",
    PERSISTED_WEFT_INTERACTED: "split-persisted-weft-active",
    TEMP_WEFT_INTERACTED: "split-temporary-weft-active",
    SPLIT_CLOSED: "full-origin",
    NAVIGATED_FULL: "full-origin",
  },
} as const satisfies Record<
  SplitFocusStatus,
  Partial<Record<SplitFocusEventType, SplitFocusStatus>>
>;

export const initialSplitFocusState: SplitFocusState = {
  status: "full-origin",
  activeSurface: "origin",
  addressableSurface: "origin",
};

export function reduceSplitFocus(
  state: SplitFocusState,
  event: SplitFocusEvent
): SplitFocusState {
  const transitions: Partial<Record<SplitFocusEventType, SplitFocusStatus>> =
    splitFocusTransitionTable[state.status];
  const nextStatus = transitions[event.type];
  if (!nextStatus) return state;
  if (event.type === "SPLIT_OPENED") {
    return stateForSplitOpened(event.weftKind);
  }
  if (nextStatus === "graph-context-switching") {
    return {
      status: "graph-context-switching",
      activeSurface: state.activeSurface,
      addressableSurface: state.addressableSurface,
      previousStatus: stableStatusFromState(state),
    };
  }
  if (state.status === "graph-context-switching" && event.type === "GRAPH_CONTEXT_SWITCHED") {
    return createSplitFocusState(state.previousStatus);
  }
  if (nextStatus === "split-closing") {
    return {
      status: "split-closing",
      activeSurface: state.activeSurface,
      addressableSurface: state.addressableSurface,
      previousStatus: stableStatusFromState(state),
    };
  }
  if (state.status === "split-closing" && event.type === "SPLIT_CLOSED") {
    return createSplitFocusState("full-origin");
  }
  if (nextStatus === state.status) return state;
  return createSplitFocusState(nextStatus);
}

export function createSplitFocusState(status: SplitFocusStableStatus): SplitFocusState;
export function createSplitFocusState(status: SplitFocusStatus): SplitFocusState {
  switch (status) {
    case "full-origin":
      return {
        status,
        activeSurface: "origin",
        addressableSurface: "origin",
      };
    case "split-origin-active":
      return {
        status,
        activeSurface: "origin",
        addressableSurface: "origin",
      };
    case "split-persisted-weft-active":
      return {
        status,
        activeSurface: "persisted-weft",
        addressableSurface: "persisted-weft",
      };
    case "split-temporary-weft-active":
      return {
        status,
        activeSurface: "temporary-weft",
        addressableSurface: "origin",
      };
    case "graph-context-switching":
      return {
        status,
        activeSurface: "origin",
        addressableSurface: "origin",
        previousStatus: "split-origin-active",
      };
    case "split-closing":
      return {
        status,
        activeSurface: "origin",
        addressableSurface: "origin",
        previousStatus: "split-origin-active",
      };
  }
}

export function splitPanelFromFocusState(
  state: SplitFocusState
): "origin" | "weft" {
  return state.activeSurface === "origin" ? "origin" : "weft";
}

export function addressablePanelFromFocusState(
  state: SplitFocusState
): "origin" | "weft" {
  return state.addressableSurface === "origin" ? "origin" : "weft";
}

function stateForSplitOpened(weftKind: SplitFocusWeftKind): SplitFocusState {
  return weftKind === "temporary"
    ? createSplitFocusState("split-temporary-weft-active")
    : createSplitFocusState("split-persisted-weft-active");
}

function stableStatusFromState(state: SplitFocusState): SplitFocusStableStatus {
  if (state.status === "graph-context-switching" || state.status === "split-closing") {
    return state.previousStatus;
  }
  return state.status;
}
