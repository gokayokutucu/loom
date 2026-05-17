// E2E data authority classification: PURE_UI_HELPER.
// This spec validates omnibox suggestion derivation without product data or TypeScript runtime fallback.
import { expect, test } from "@playwright/test";
import {
  buildAddressBarSuggestions,
  isAddressBarAddressLike,
  resolveAddressBarEnterAction,
} from "../src/services/omnibox";
import type { Conversation } from "../src/types";

const conversations: Conversation[] = [
  {
    id: "loom-local-runtime",
    title: "Local runtime architecture",
    path: "loom://looms/local-runtime-architecture",
    folder: "Architecture",
    summary: "Rust service and SQLite persistence",
    meta: {
      code: "L-LOCAL-RUNTIME-LONG",
      displayCode: "L-A7K2M",
      canonicalUri: "loom://looms/local-runtime-architecture",
    },
  },
  {
    id: "weft-mcp-boundary",
    title: "MCP boundary Weft",
    path: "loom://looms/local-runtime-architecture/wefts/mcp-boundary",
    folder: "Architecture",
    summary: "Branch from runtime work",
    meta: {
      code: "W-WEFT-R-MCP-BOUNDARY-1778844558412187000",
      displayCode: "W-K7M2Q",
      canonicalUri: "loom://looms/local-runtime-architecture/wefts/mcp-boundary",
    },
  },
];

test.describe("[omnibox] address bar suggestions", () => {
  test("title search returns Loom suggestions", () => {
    const suggestions = buildAddressBarSuggestions({
      query: "local runtime",
      conversations,
    });

    expect(suggestions[0]).toMatchObject({
      title: "Local runtime architecture",
      badge: "Loom",
      referenceCode: "L-A7K2M",
    });
  });

  test("title search returns Weft suggestions", () => {
    const suggestions = buildAddressBarSuggestions({
      query: "mcp boundary",
      conversations,
    });

    expect(suggestions[0]).toMatchObject({
      title: "MCP boundary Weft",
      badge: "Weft",
      referenceCode: "W-K7M2Q",
    });
  });

  test("display code search can find a Loom without exposing canonical id as title", () => {
    const suggestions = buildAddressBarSuggestions({
      query: "W-K7M2Q",
      conversations,
    });

    expect(suggestions[0].title).toBe("MCP boundary Weft");
    expect(suggestions[0].title).not.toContain("1778844558412187000");
  });

  test("loom URI input is treated as address input", () => {
    expect(isAddressBarAddressLike(" loom://looms/local-runtime-architecture ")).toBe(true);
    expect(isAddressBarAddressLike("explain local runtime")).toBe(false);
  });

  test("Enter with visible suggestions but no selected suggestion starts a prompt", () => {
    const suggestions = buildAddressBarSuggestions({
      query: "local runtime",
      conversations,
    });

    expect(
      resolveAddressBarEnterAction({
        query: "local runtime",
        suggestions,
        selectedSuggestion: -1,
      })
    ).toEqual({ kind: "prompt", prompt: "local runtime" });
  });

  test("Enter with selected suggestion navigates to that suggestion", () => {
    const suggestions = buildAddressBarSuggestions({
      query: "local runtime",
      conversations,
    });

    expect(
      resolveAddressBarEnterAction({
        query: "local runtime",
        suggestions,
        selectedSuggestion: 0,
      })
    ).toMatchObject({
      kind: "suggestion",
      suggestion: { title: "Local runtime architecture" },
    });
  });

  test("Enter with an address keeps resolver navigation path", () => {
    expect(
      resolveAddressBarEnterAction({
        query: "loom://looms/local-runtime-architecture",
        suggestions: [],
        selectedSuggestion: -1,
      })
    ).toEqual({
      kind: "address",
      address: "loom://looms/local-runtime-architecture",
    });
  });
});
