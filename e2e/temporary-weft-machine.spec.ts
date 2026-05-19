import { expect, test } from "@playwright/test";
import {
  reduceTemporaryWeftLifecycle,
  temporaryWeftTransitionTable,
  type TemporaryWeftLifecycleState,
} from "../src/state/temporaryWeftMachine";

test.describe("[pure-state] Temporary Weft lifecycle machine", () => {
  test("absent opens a temporary workspace", () => {
    expect(
      reduceTemporaryWeftLifecycle({ status: "absent" }, { type: "OPEN_TEMP" })
    ).toEqual({ status: "temporary" });
  });

  test("temporary focuses into active", () => {
    expect(
      reduceTemporaryWeftLifecycle({ status: "temporary" }, { type: "FOCUS_TEMP" })
    ).toEqual({ status: "active" });
  });

  test("temporary and active submit first prompt into promoting", () => {
    const states: TemporaryWeftLifecycleState[] = [
      { status: "temporary" },
      { status: "active" },
    ];

    for (const state of states) {
      expect(
        reduceTemporaryWeftLifecycle(state, { type: "SUBMIT_FIRST_PROMPT" })
      ).toEqual({ status: "promoting" });
    }
  });

  test("promoting persists when promotion succeeds", () => {
    expect(
      reduceTemporaryWeftLifecycle(
        { status: "promoting" },
        { type: "PROMOTION_SUCCEEDED", persistedWeftId: "loom-weft-1" }
      )
    ).toEqual({ status: "persisted", persistedWeftId: "loom-weft-1" });
  });

  test("promoting enters promotion-error when promotion fails", () => {
    expect(
      reduceTemporaryWeftLifecycle(
        { status: "promoting" },
        { type: "PROMOTION_FAILED", errorMessage: "service unavailable" }
      )
    ).toEqual({ status: "promotion-error", errorMessage: "service unavailable" });
  });

  test("temporary and active discard or close before promotion", () => {
    for (const status of ["temporary", "active"] as const) {
      expect(
        reduceTemporaryWeftLifecycle({ status }, { type: "DISCARD_TEMP" })
      ).toEqual({ status: "discarded" });
      expect(
        reduceTemporaryWeftLifecycle({ status }, { type: "CLOSE_SPLIT" })
      ).toEqual({ status: "discarded" });
    }
  });

  test("persisted is not discarded by close", () => {
    const state: TemporaryWeftLifecycleState = {
      status: "persisted",
      persistedWeftId: "loom-weft-1",
    };

    expect(
      reduceTemporaryWeftLifecycle(state, { type: "CLOSE_SPLIT" })
    ).toBe(state);
  });

  test("invalid transition does not corrupt state", () => {
    const state: TemporaryWeftLifecycleState = { status: "absent" };

    expect(
      reduceTemporaryWeftLifecycle(state, {
        type: "PROMOTION_SUCCEEDED",
        persistedWeftId: "loom-weft-1",
      })
    ).toBe(state);
  });

  test("transition table contains every lifecycle state", () => {
    expect(Object.keys(temporaryWeftTransitionTable).sort()).toEqual([
      "absent",
      "active",
      "discarded",
      "persisted",
      "promoting",
      "promotion-error",
      "temporary",
    ]);
  });
});
