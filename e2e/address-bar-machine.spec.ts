import { expect, test } from "@playwright/test";
import {
  addressBarTransitionTable,
  isAddressBarFocusedState,
  reduceAddressBar,
  type AddressBarState,
} from "../src/state/addressBarMachine";

test.describe("[pure-state] Address Bar lifecycle machine", () => {
  test("idle focuses", () => {
    const next = reduceAddressBar({ status: "idle" }, { type: "FOCUS" });

    expect(next).toEqual({ status: "focused" });
    expect(isAddressBarFocusedState(next)).toBe(true);
  });

  test("focused enters typing on input change", () => {
    expect(reduceAddressBar({ status: "focused" }, { type: "INPUT_CHANGED" })).toEqual({
      status: "typing",
    });
  });

  test("submit address resolves, navigates, and returns idle", () => {
    const submitted = reduceAddressBar({ status: "typing" }, { type: "SUBMIT" });
    const resolving = reduceAddressBar(submitted, { type: "ADDRESS_DETECTED" });
    const navigating = reduceAddressBar(resolving, { type: "RESOLVE_SUCCEEDED" });
    const idle = reduceAddressBar(navigating, { type: "NAVIGATION_FINISHED" });

    expect(submitted).toEqual({ status: "typing" });
    expect(resolving).toEqual({ status: "resolving-address" });
    expect(navigating).toEqual({ status: "navigating" });
    expect(idle).toEqual({ status: "idle" });
  });

  test("submit free text enters prompt-submit and returns idle", () => {
    const submitted = reduceAddressBar({ status: "typing" }, { type: "SUBMIT" });
    const promptSubmit = reduceAddressBar(submitted, { type: "FREE_TEXT_DETECTED" });

    expect(promptSubmit).toEqual({ status: "prompt-submit" });
    expect(reduceAddressBar(promptSubmit, { type: "NAVIGATION_FINISHED" })).toEqual({
      status: "idle",
    });
  });

  test("resolve failure enters error", () => {
    expect(
      reduceAddressBar({ status: "resolving-address" }, { type: "RESOLVE_FAILED" })
    ).toEqual({ status: "error" });
  });

  test("reset clears transient state", () => {
    expect(reduceAddressBar({ status: "error" }, { type: "RESET" })).toEqual({
      status: "idle",
    });
    expect(reduceAddressBar({ status: "feedback" }, { type: "RESET" })).toEqual({
      status: "idle",
    });
  });

  test("invalid transitions are safe", () => {
    const state: AddressBarState = { status: "idle" };

    expect(reduceAddressBar(state, { type: "NAVIGATION_FINISHED" })).toBe(state);
  });

  test("transition table contains every Address Bar state", () => {
    expect(Object.keys(addressBarTransitionTable).sort()).toEqual([
      "error",
      "feedback",
      "focused",
      "idle",
      "navigating",
      "prompt-submit",
      "resolving-address",
      "typing",
    ]);
  });
});
