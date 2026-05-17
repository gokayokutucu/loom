import { expect, test } from "@playwright/test";
import { formatBadgeCode, formatDisplayCode } from "../src/services/displayCode";

test.describe("display-safe Loom and Weft codes", () => {
  test("leaves short normal codes unchanged", () => {
    expect(formatDisplayCode("L-PROJECT")).toBe("L-PROJECT");
  });

  test("preserves Weft prefix and removes trailing timestamp", () => {
    expect(
      formatDisplayCode("W-WEFT-R-MCP-ERROR-BOUNDARY-1778844558412187000")
    ).toBe("W-WEFT · MCP ERROR");
  });

  test("handles non-Weft long codes with trailing timestamps", () => {
    expect(formatDisplayCode("R-MCP-ERROR-BOUNDARY-1778844558412187000")).toBe(
      "R-MCP-ERROR-BOUNDARY"
    );
  });

  test("keeps timestamp-free Weft codes semantic and compact", () => {
    expect(formatDisplayCode("W-WEFT-R-MCP-ERROR-BOUNDARY")).toBe(
      "W-WEFT · MCP ERROR"
    );
  });

  test("keeps graph Weft labels short enough for node badges", () => {
    expect(
      formatDisplayCode("W-WEFT-R-MCP-INVOCATION-FLOW-1778832856779443000")
    ).toBe("W-WEFT · MCP INVOCATION");
  });

  test("handles empty defensive inputs", () => {
    expect(formatDisplayCode("")).toBe("");
    expect(formatDisplayCode(null)).toBe("");
    expect(formatDisplayCode(undefined)).toBe("");
  });

  test("does not mutate the full canonical code value", () => {
    const fullCode = "W-WEFT-R-MCP-ERROR-BOUNDARY-1778844558412187000";
    const originalCode = fullCode;

    expect(formatDisplayCode(fullCode)).toBe("W-WEFT · MCP ERROR");
    expect(fullCode).toBe(originalCode);
  });

  test("prefers service displayCode for visible badges", () => {
    expect(
      formatBadgeCode({
        code: "W-WEFT-R-MCP-INVOCATION-FLOW-1778832856779443000",
        displayCode: "W-K7M2Q",
      })
    ).toBe("W-K7M2Q");
  });

  test("falls back to formatted canonical code for old payloads", () => {
    expect(
      formatBadgeCode({
        code: "W-WEFT-R-MCP-INVOCATION-FLOW-1778832856779443000",
      })
    ).toBe("W-WEFT · MCP INVOCATION");
  });
});
