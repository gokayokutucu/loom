import { describe, expect, it } from "vitest";
import {
  firstRenderedFragmentTextMatch,
  referenceNavigationOverridesForLink,
} from "./referenceFragmentScroll";

describe("referenceNavigationOverridesForLink", () => {
  it("builds a fragment destination for selected-text references", () => {
    expect(
      referenceNavigationOverridesForLink(
        { selectedText: "Snapshot strategy", fragmentHash: "frag-1" },
        "response-1"
      )
    ).toEqual({
      scrollTargetResponseId: "response-1",
      scrollMode: "fragment",
      fragmentText: "Snapshot strategy",
      fragmentHash: "frag-1",
      fragmentIncludeCode: undefined,
    });
  });

  it("marks code block references as safe to match inside code", () => {
    expect(
      referenceNavigationOverridesForLink(
        {
          selectedText: "const state = replay(stream);",
          fragmentHash: "code-1",
          targetKind: "code_block",
        },
        "response-1"
      )
    ).toMatchObject({
      scrollMode: "fragment",
      fragmentIncludeCode: true,
    });
  });

  it("builds a response destination for response-level references", () => {
    expect(referenceNavigationOverridesForLink({}, "response-1")).toEqual({
      scrollTargetResponseId: "response-1",
      scrollMode: "exact",
      fragmentText: undefined,
      fragmentHash: undefined,
      fragmentIncludeCode: undefined,
    });
  });
});

describe("firstRenderedFragmentTextMatch", () => {
  it("finds exact selected text in rendered response text", () => {
    expect(
      firstRenderedFragmentTextMatch(
        "Intro. Snapshot strategy reduces long replay cost.",
        "Snapshot strategy"
      )
    ).toEqual({ start: 7, end: 24 });
  });

  it("falls back safely when selected text is missing", () => {
    expect(firstRenderedFragmentTextMatch("Intro only.", "Missing fragment")).toBeNull();
  });

  it("uses the first match deterministically when text repeats", () => {
    expect(firstRenderedFragmentTextMatch("Replay, Replay, Replay", "Replay")).toEqual({
      start: 0,
      end: 6,
    });
  });
});
