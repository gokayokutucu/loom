import { expect, test } from "@playwright/test";
import {
  addressablePanelFromFocusState,
  reduceSplitFocus,
  splitFocusTransitionTable,
  splitPanelFromFocusState,
  type SplitFocusState,
} from "../src/state/splitFocusMachine";

test.describe("[pure-state] Split focus active-surface machine", () => {
  test("origin click makes origin active", () => {
    const state: SplitFocusState = {
      status: "split-persisted-weft-active",
      activeSurface: "persisted-weft",
      addressableSurface: "persisted-weft",
    };

    expect(reduceSplitFocus(state, { type: "ORIGIN_INTERACTED" })).toEqual({
      status: "split-origin-active",
      activeSurface: "origin",
      addressableSurface: "origin",
    });
  });

  test("persisted Weft click makes persisted Weft active and addressable", () => {
    const next = reduceSplitFocus(
      {
        status: "split-origin-active",
        activeSurface: "origin",
        addressableSurface: "origin",
      },
      { type: "PERSISTED_WEFT_INTERACTED" }
    );

    expect(next).toEqual({
      status: "split-persisted-weft-active",
      activeSurface: "persisted-weft",
      addressableSurface: "persisted-weft",
    });
    expect(splitPanelFromFocusState(next)).toBe("weft");
    expect(addressablePanelFromFocusState(next)).toBe("weft");
  });

  test("temp Weft click makes temp active but keeps addressable target on origin", () => {
    const next = reduceSplitFocus(
      {
        status: "split-origin-active",
        activeSurface: "origin",
        addressableSurface: "origin",
      },
      { type: "TEMP_WEFT_INTERACTED" }
    );

    expect(next).toEqual({
      status: "split-temporary-weft-active",
      activeSurface: "temporary-weft",
      addressableSurface: "origin",
    });
    expect(splitPanelFromFocusState(next)).toBe("weft");
    expect(addressablePanelFromFocusState(next)).toBe("origin");
  });

  test("temp promoted while active makes persisted Weft active", () => {
    expect(
      reduceSplitFocus(
        {
          status: "split-temporary-weft-active",
          activeSurface: "temporary-weft",
          addressableSurface: "origin",
        },
        { type: "TEMP_WEFT_PROMOTED" }
      )
    ).toEqual({
      status: "split-persisted-weft-active",
      activeSurface: "persisted-weft",
      addressableSurface: "persisted-weft",
    });
  });

  test("close split returns to full-origin", () => {
    const closing = reduceSplitFocus(
      {
        status: "split-temporary-weft-active",
        activeSurface: "temporary-weft",
        addressableSurface: "origin",
      },
      { type: "SPLIT_CLOSED" }
    );

    expect(closing).toEqual({
      status: "split-closing",
      activeSurface: "temporary-weft",
      addressableSurface: "origin",
      previousStatus: "split-temporary-weft-active",
    });
    expect(reduceSplitFocus(closing, { type: "SPLIT_CLOSED" })).toEqual({
      status: "full-origin",
      activeSurface: "origin",
      addressableSurface: "origin",
    });
  });

  test("graph context switch completes without losing active surface", () => {
    const active: SplitFocusState = {
      status: "split-persisted-weft-active",
      activeSurface: "persisted-weft",
      addressableSurface: "persisted-weft",
    };
    const switching = reduceSplitFocus(active, { type: "GRAPH_CONTEXT_SWITCHED" });

    expect(switching).toEqual({
      status: "graph-context-switching",
      activeSurface: "persisted-weft",
      addressableSurface: "persisted-weft",
      previousStatus: "split-persisted-weft-active",
    });
    expect(reduceSplitFocus(switching, { type: "GRAPH_CONTEXT_SWITCHED" })).toEqual(active);
  });

  test("invalid transition returns the same state object", () => {
    const state: SplitFocusState = {
      status: "full-origin",
      activeSurface: "origin",
      addressableSurface: "origin",
    };

    expect(reduceSplitFocus(state, { type: "TEMP_WEFT_PROMOTED" })).toBe(state);
  });

  test("transition table contains every split focus state", () => {
    expect(Object.keys(splitFocusTransitionTable).sort()).toEqual([
      "full-origin",
      "graph-context-switching",
      "split-closing",
      "split-origin-active",
      "split-persisted-weft-active",
      "split-temporary-weft-active",
    ]);
  });
});
