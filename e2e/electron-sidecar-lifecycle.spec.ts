import { expect, test } from "@playwright/test";
import {
  createSidecarLifecycleState,
  sidecarEventForBinaryResolution,
  sidecarEventForPortAvailability,
  sidecarLifecycleEvents,
  sidecarLifecycleStates,
  transitionSidecarLifecycle,
} from "../electron/sidecar-lifecycle.mjs";

function applyEvents(events: string[]) {
  return events.reduce(
    (state, event) => transitionSidecarLifecycle(state, event),
    createSidecarLifecycleState()
  );
}

test.describe("[pure-state] Electron sidecar lifecycle", () => {
  test("documents sidecar states and events", () => {
    expect(sidecarLifecycleStates).toEqual([
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
    ]);
    expect(sidecarLifecycleEvents).toEqual([
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
    ]);
  });

  test("startup happy path reaches ready", () => {
    const snapshot = applyEvents([
      "START_REQUESTED",
      "BINARY_RESOLVED",
      "PORT_AVAILABLE",
      "PROCESS_SPAWNED",
      "HEALTH_READY",
    ]);

    expect(snapshot).toMatchObject({
      state: "ready",
      lastEvent: "HEALTH_READY",
      action: "publish-service-url",
      invalid: false,
    });
  });

  test("missing binary moves to error", () => {
    const snapshot = applyEvents(["START_REQUESTED", sidecarEventForBinaryResolution(false)]);

    expect(snapshot).toMatchObject({
      state: "error",
      lastEvent: "BINARY_MISSING",
      action: "fail",
      invalid: false,
    });
  });

  test("unknown port owner moves to error without kill action", () => {
    const snapshot = applyEvents([
      "START_REQUESTED",
      "BINARY_RESOLVED",
      sidecarEventForPortAvailability(false),
    ]);

    expect(snapshot).toMatchObject({
      state: "error",
      lastEvent: "PORT_OCCUPIED_UNKNOWN",
      action: "fail-preserve-unknown-process",
      invalid: false,
    });
    expect(snapshot.action).not.toContain("kill");
    expect(snapshot.action).not.toContain("stop");
  });

  test("spawned then health ready publishes a ready service URL", () => {
    const healthChecking = applyEvents([
      "START_REQUESTED",
      "BINARY_RESOLVED",
      "PORT_AVAILABLE",
      "PROCESS_SPAWNED",
    ]);
    const ready = transitionSidecarLifecycle(healthChecking, "HEALTH_READY");

    expect(healthChecking).toMatchObject({
      state: "health-checking",
      action: "poll-health",
    });
    expect(ready).toMatchObject({
      state: "ready",
      action: "publish-service-url",
    });
  });

  test("restart stops the owned child then starts a new lifecycle", () => {
    const restarting = transitionSidecarLifecycle(
      createSidecarLifecycleState("ready"),
      "RESTART_REQUESTED"
    );
    const resolving = transitionSidecarLifecycle(restarting, "START_REQUESTED");

    expect(restarting).toMatchObject({
      state: "restarting",
      action: "stop-owned-child-then-start",
    });
    expect(resolving).toMatchObject({
      state: "resolving-binary",
      action: "resolve-binary",
    });
  });

  test("stop requests target only the owned child", () => {
    const stopping = transitionSidecarLifecycle(createSidecarLifecycleState("ready"), {
      type: "STOP_REQUESTED",
    });
    const stopped = transitionSidecarLifecycle(stopping, "PROCESS_EXITED");

    expect(stopping).toMatchObject({
      state: "stopping",
      action: "stop-owned-child",
    });
    expect(stopped).toMatchObject({
      state: "stopped",
      action: "clear-owned-child",
    });
  });

  test("unexpected process exit moves to exited", () => {
    const snapshot = transitionSidecarLifecycle(
      createSidecarLifecycleState("ready"),
      "PROCESS_EXITED"
    );

    expect(snapshot).toMatchObject({
      state: "exited",
      action: "clear-owned-child",
      invalid: false,
    });
  });

  test("health failure moves to error and preserves the error message", () => {
    const snapshot = transitionSidecarLifecycle(createSidecarLifecycleState("health-checking"), {
      type: "HEALTH_FAILED",
      error: "health timed out",
    });

    expect(snapshot).toMatchObject({
      state: "error",
      action: "fail",
      error: "health timed out",
    });
  });

  test("invalid transitions are safe no-ops", () => {
    const ready = createSidecarLifecycleState("ready");
    const snapshot = transitionSidecarLifecycle(ready, "BINARY_MISSING");

    expect(snapshot).toMatchObject({
      state: "ready",
      action: "none",
      invalid: true,
      lastEvent: "BINARY_MISSING",
    });
  });
});
