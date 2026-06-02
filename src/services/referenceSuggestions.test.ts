import { describe, expect, it } from "vitest";

import {
  filterAndRankReferenceSuggestions,
  readableReferenceCode,
  responseCodeQuery,
  scoreReferenceSuggestion,
  type ReferenceSuggestionSearchItem,
} from "./referenceSuggestions";

function responseSuggestion(input: {
  id: string;
  code: string;
  title?: string;
  loomTitle?: string;
}): ReferenceSuggestionSearchItem {
  return {
    id: input.id,
    type: "response",
    title: input.title ?? "Response answer",
    path: `loom://demo/L-DEMO/r/${input.code}?id=${input.id}`,
    badge: "Response",
    referenceCode: input.code,
    sourceLoomId: input.loomTitle ? `loom-${input.loomTitle}` : "loom-current",
    sourceResponseId: input.id,
    subtitle: input.loomTitle ?? "Current Loom",
    searchText: [input.loomTitle ?? "Current Loom"],
  };
}

describe("referenceSuggestions CodeID matching", () => {
  it("detects response CodeID queries inside # autocomplete text", () => {
    expect(responseCodeQuery("R-3V8LHA")).toBe("R-3V8LHA");
    expect(responseCodeQuery("please use R-3V8LHA")).toBe("R-3V8LHA");
    expect(responseCodeQuery("r-3v")).toBe("r-3v");
    expect(responseCodeQuery("L-3V8LHA")).toBe("");
  });

  it("ranks exact response CodeID matches first", () => {
    const exact = responseSuggestion({ id: "response-exact", code: "R-3V8LHA" });
    const prefix = responseSuggestion({ id: "response-prefix", code: "R-3V8ZZZ" });
    const titleOnly: ReferenceSuggestionSearchItem = {
      id: "loom-with-title",
      type: "conversation",
      title: "R-3V8LHA planning Loom",
      path: "loom://demo/L-TITLE",
      badge: "Loom",
    };

    const ranked = filterAndRankReferenceSuggestions([titleOnly, prefix, exact], "R-3V8LHA");

    expect(ranked[0]?.id).toBe("response-exact");
    expect(ranked[0]?.suggestionMatchReason).toBe("code: R-3V8LHA");
  });

  it("keeps response suggestions mapped to response-level LoomLinks", () => {
    const item = responseSuggestion({ id: "response-1", code: "R-ABCDE" });

    expect(item.type).toBe("response");
    expect(item.sourceResponseId).toBe("response-1");
    expect(item.sourceLoomId).toBe("loom-current");
    expect(item.path).toContain("/r/R-ABCDE");
    expect(readableReferenceCode(item)).toBe("R-ABCDE");
  });

  it("uses visible displayCode when referenceCode is absent", () => {
    const item: ReferenceSuggestionSearchItem = {
      id: "response-with-display-code",
      type: "response",
      title: "Visible display code response",
      path: "loom://demo/L-DEMO/r/R-LONG?id=response-with-display-code",
      badge: "Response",
      meta: {
        id: "response-with-display-code",
        code: "R-LONG-CODE-1779620886518373000",
        displayCode: "R-VISIBLE",
        title: "Visible display code response",
        keywords: [],
        summary: "",
        usageCount: 0,
        status: "addressable",
      },
    };

    expect(readableReferenceCode(item)).toBe("R-VISIBLE");
    expect(scoreReferenceSuggestion(item, "R-VISIBLE").score).toBeGreaterThan(0);
  });

  it("keeps ambiguous exact CodeID matches in caller-provided order", () => {
    const currentLoomResponse = responseSuggestion({
      id: "current-response",
      code: "R-SAME1",
      loomTitle: "Current Loom",
    });
    const otherLoomResponse = responseSuggestion({
      id: "other-response",
      code: "R-SAME1",
      loomTitle: "Other Loom",
    });

    const ranked = filterAndRankReferenceSuggestions(
      [currentLoomResponse, otherLoomResponse],
      "R-SAME1"
    );

    expect(ranked.map((item) => item.id)).toEqual(["current-response", "other-response"]);
    expect(ranked[0]?.subtitle).toBe("Current Loom");
    expect(ranked[1]?.subtitle).toBe("Other Loom");
  });
});
