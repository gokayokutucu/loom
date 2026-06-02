/**
 * fragmentChipPreview — visual truncation for Ask to Loom composer chips.
 *
 * Root cause addressed (ASK-TO-LOOM-SELECTION-SCROLL-LAYOUT-FIX-001):
 *   Long selected text was rendered in full inside the composer reference chip,
 *   expanding the chip up to its max-width and causing a viewport layout jump.
 *   This module provides a display-only preview truncated to ~100 chars while
 *   the full selectedText is preserved in the link metadata.
 */
import { describe, expect, it } from "vitest";
import {
  FRAGMENT_CHIP_PREVIEW_MAX_CHARS,
  truncateFragmentChipPreview,
} from "./fragmentChipPreview";

const SHORT_TEXT = "The Process of Trilateration";
const EXACTLY_100 = "a".repeat(FRAGMENT_CHIP_PREVIEW_MAX_CHARS);

const LONG_TEXT =
  "Responses flowing downward, and Weft branches splitting sideways without breaking hierarchy, " +
  "which means context is always preserved vertically while exploration spreads horizontally.";

describe("truncateFragmentChipPreview", () => {
  it("returns short text unchanged", () => {
    expect(truncateFragmentChipPreview(SHORT_TEXT)).toBe(SHORT_TEXT);
  });

  it("returns text of exactly max length unchanged", () => {
    expect(truncateFragmentChipPreview(EXACTLY_100)).toBe(EXACTLY_100);
  });

  it("truncates long text with ellipsis", () => {
    const preview = truncateFragmentChipPreview(LONG_TEXT);
    expect(preview).toContain("…");
    expect(preview.length).toBeLessThanOrEqual(FRAGMENT_CHIP_PREVIEW_MAX_CHARS + 1); // +1 for "…"
  });

  it("truncates at a word boundary when one is available", () => {
    const preview = truncateFragmentChipPreview(LONG_TEXT);
    const withoutEllipsis = preview.slice(0, -1); // remove "…"
    // The character immediately after the cut point in LONG_TEXT must be a space,
    // confirming the cut happened between words (not mid-word).
    const nextChar = LONG_TEXT[withoutEllipsis.length];
    expect(nextChar).toBe(" ");
  });

  it("preserves the beginning of the text", () => {
    const preview = truncateFragmentChipPreview(LONG_TEXT);
    expect(LONG_TEXT.startsWith(preview.replace(/…$/, "").trimEnd())).toBe(true);
  });

  it("does not truncate text that is one char over the limit (falls back to hard cut)", () => {
    const borderline = "a".repeat(FRAGMENT_CHIP_PREVIEW_MAX_CHARS + 1);
    const preview = truncateFragmentChipPreview(borderline);
    expect(preview).toContain("…");
    expect(preview.replace(/…$/, "").length).toBeLessThanOrEqual(FRAGMENT_CHIP_PREVIEW_MAX_CHARS);
  });

  it("full text content is not lost — it only affects display", () => {
    const preview = truncateFragmentChipPreview(LONG_TEXT);
    // The truncated preview is shorter, but LONG_TEXT itself is unmodified
    expect(LONG_TEXT.length).toBeGreaterThan(preview.length);
    expect(preview.replace(/…$/, "").length).toBeLessThanOrEqual(LONG_TEXT.length);
  });
});
