export const sidecarLifecycleStates = [
  "stopped",
  "resolving-binary",
  "checking-port",
  "starting",
  "health-checking",
  "ready",
  "restarting",
  "stopping",
  "error",
  "exited",
];

export const sidecarLifecycleEvents = [
  "START_REQUESTED",
  "BINARY_RESOLVED",
  "BINARY_MISSING",
  "PORT_AVAILABLE",
  "PORT_OCCUPIED_UNKNOWN",
  "PROCESS_SPAWNED",
  "HEALTH_READY",
  "HEALTH_FAILED",
  "RESTART_REQUESTED",
  "STOP_REQUESTED",
  "PROCESS_EXITED",
  "ERROR",
  "RESET",
];

const transitionTable = {
  stopped: {
    START_REQUESTED: { state: "resolving-binary", action: "resolve-binary" },
    RESET: { state: "stopped", action: "none" },
  },
  "resolving-binary": {
    BINARY_RESOLVED: { state: "checking-port", action: "check-port" },
    BINARY_MISSING: { state: "error", action: "fail" },
    ERROR: { state: "error", action: "fail" },
    RESET: { state: "stopped", action: "none" },
  },
  "checking-port": {
    PORT_AVAILABLE: { state: "starting", action: "spawn-owned-sidecar" },
    PORT_OCCUPIED_UNKNOWN: { state: "error", action: "fail-preserve-unknown-process" },
    ERROR: { state: "error", action: "fail" },
    RESET: { state: "stopped", action: "none" },
  },
  starting: {
    PROCESS_SPAWNED: { state: "health-checking", action: "poll-health" },
    PROCESS_EXITED: { state: "exited", action: "clear-owned-child" },
    HEALTH_FAILED: { state: "error", action: "fail" },
    ERROR: { state: "error", action: "fail" },
    STOP_REQUESTED: { state: "stopping", action: "stop-owned-child" },
    RESET: { state: "stopped", action: "none" },
  },
  "health-checking": {
    HEALTH_READY: { state: "ready", action: "publish-service-url" },
    HEALTH_FAILED: { state: "error", action: "fail" },
    PROCESS_EXITED: { state: "exited", action: "clear-owned-child" },
    STOP_REQUESTED: { state: "stopping", action: "stop-owned-child" },
    RESET: { state: "stopped", action: "none" },
  },
  ready: {
    RESTART_REQUESTED: { state: "restarting", action: "stop-owned-child-then-start" },
    STOP_REQUESTED: { state: "stopping", action: "stop-owned-child" },
    PROCESS_EXITED: { state: "exited", action: "clear-owned-child" },
    ERROR: { state: "error", action: "fail" },
    RESET: { state: "stopped", action: "none" },
  },
  restarting: {
    START_REQUESTED: { state: "resolving-binary", action: "resolve-binary" },
    PORT_AVAILABLE: { state: "starting", action: "spawn-owned-sidecar" },
    PROCESS_SPAWNED: { state: "health-checking", action: "poll-health" },
    HEALTH_READY: { state: "ready", action: "publish-service-url" },
    HEALTH_FAILED: { state: "error", action: "fail" },
    PROCESS_EXITED: { state: "exited", action: "clear-owned-child" },
    ERROR: { state: "error", action: "fail" },
    RESET: { state: "stopped", action: "none" },
  },
  stopping: {
    PROCESS_EXITED: { state: "stopped", action: "clear-owned-child" },
    ERROR: { state: "error", action: "fail" },
    RESET: { state: "stopped", action: "none" },
  },
  error: {
    START_REQUESTED: { state: "resolving-binary", action: "resolve-binary" },
    RESET: { state: "stopped", action: "none" },
  },
  exited: {
    START_REQUESTED: { state: "resolving-binary", action: "resolve-binary" },
    RESET: { state: "stopped", action: "none" },
  },
};

export const sidecarLifecycleTransitionTable = transitionTable;

export function createSidecarLifecycleState(state = "stopped") {
  return {
    state,
    lastEvent: undefined,
    action: "none",
    error: undefined,
  };
}

export function transitionSidecarLifecycle(current, event) {
  const currentState =
    typeof current === "string" ? createSidecarLifecycleState(current) : { ...current };
  const eventType = typeof event === "string" ? event : event?.type;
  const error = typeof event === "object" ? event.error : undefined;
  const transition = transitionTable[currentState.state]?.[eventType];

  if (!transition) {
    return {
      ...currentState,
      lastEvent: eventType,
      action: "none",
      invalid: true,
    };
  }

  return {
    state: transition.state,
    lastEvent: eventType,
    action: transition.action,
    error,
    invalid: false,
  };
}

export function sidecarEventForPortAvailability(isAvailable) {
  return isAvailable ? "PORT_AVAILABLE" : "PORT_OCCUPIED_UNKNOWN";
}

export function sidecarEventForBinaryResolution(exists) {
  return exists ? "BINARY_RESOLVED" : "BINARY_MISSING";
}
