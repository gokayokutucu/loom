import { describe, expect, it } from "vitest";
import { extractCleanLoomAddress } from "./addressBarContextMenu";

describe("extractCleanLoomAddress", () => {
  // ── Returns null for non-loom strings ──────────────────────────────────────

  it("returns null for an empty string", () => {
    expect(extractCleanLoomAddress("")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(extractCleanLoomAddress("hello world")).toBeNull();
  });

  it("returns null for an https URL", () => {
    expect(extractCleanLoomAddress("https://example.com/path")).toBeNull();
  });

  it("returns null for a string that contains loom:// but does not start with it", () => {
    expect(extractCleanLoomAddress("See loom://my-loom/L-123")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(extractCleanLoomAddress("   ")).toBeNull();
  });

  // ── Clean pass-through ──────────────────────────────────────────────────────

  it("returns the address unchanged when it is already clean", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("preserves query params", () => {
    expect(
      extractCleanLoomAddress("loom://my-loom/L-123?id=abc-def")
    ).toBe("loom://my-loom/L-123?id=abc-def");
  });

  it("preserves fragments", () => {
    expect(
      extractCleanLoomAddress("loom://my-loom/L-123#section")
    ).toBe("loom://my-loom/L-123#section");
  });

  it("preserves query params and fragment together", () => {
    expect(
      extractCleanLoomAddress("loom://my-loom/L-123?id=abc#top")
    ).toBe("loom://my-loom/L-123?id=abc#top");
  });

  it("preserves response path segments", () => {
    const url =
      "loom://clean-duplicate-probe/L-HX8PS/r/R-00000?id=response-workflow-1779620886518373000-assistant";
    expect(extractCleanLoomAddress(url)).toBe(url);
  });

  // ── Leading/trailing whitespace ─────────────────────────────────────────────

  it("trims leading and trailing whitespace", () => {
    expect(extractCleanLoomAddress("  loom://my-loom/L-123  ")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("trims only leading whitespace when no trailing punctuation", () => {
    expect(extractCleanLoomAddress("  loom://my-loom/L-123")).toBe(
      "loom://my-loom/L-123"
    );
  });

  // ── Trailing sentence punctuation ──────────────────────────────────────────

  it("strips a trailing period", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123.")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips a trailing closing parenthesis", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123)")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips a trailing closing bracket", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123]")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips trailing comma", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123,")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips trailing semicolon", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123;")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips trailing colon", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123:")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips trailing exclamation mark", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123!")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips trailing question mark", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123?")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips multiple trailing punctuation characters", () => {
    expect(extractCleanLoomAddress("loom://my-loom/L-123).")).toBe(
      "loom://my-loom/L-123"
    );
  });

  it("strips trailing punctuation after a URL with query params", () => {
    expect(
      extractCleanLoomAddress("loom://my-loom/L-123?id=abc-def).")
    ).toBe("loom://my-loom/L-123?id=abc-def");
  });

  // ── Does NOT strip internal punctuation ────────────────────────────────────

  it("does not strip a dot that is part of the path", () => {
    // dots inside the path/query are valid URL characters
    const url = "loom://my-loom/L-123?id=abc.def";
    expect(extractCleanLoomAddress(url)).toBe(url);
  });

  it("does not strip a question mark that is part of the query string", () => {
    const url = "loom://my-loom/L-123?id=abc";
    expect(extractCleanLoomAddress(url)).toBe(url);
  });

  // ── Whitespace + punctuation combined ──────────────────────────────────────

  it("trims whitespace then strips trailing punctuation", () => {
    expect(extractCleanLoomAddress("  loom://my-loom/L-123).  ")).toBe(
      "loom://my-loom/L-123"
    );
  });
});
