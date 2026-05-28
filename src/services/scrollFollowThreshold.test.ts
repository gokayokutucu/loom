/**
 * Unit tests for the shouldFollowAfterAnchor threshold logic.
 *
 * The function is not exported from App.tsx (it lives inside the component),
 * so we test the extracted pure logic here.  The implementation in App.tsx
 * mirrors this exactly.
 */

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Extracted pure implementation (mirrors App.tsx shouldFollowAfterAnchor)
// ---------------------------------------------------------------------------

function shouldFollowAfterAnchor(
  container: { getBoundingClientRect(): DOMRect },
  tailEl: { getBoundingClientRect(): DOMRect } | null,
  gap = 24
): boolean {
  if (!tailEl) return true;
  const containerRect = container.getBoundingClientRect();
  const tailRect = tailEl.getBoundingClientRect();
  return tailRect.bottom > containerRect.bottom - gap;
}

/** Build a minimal DOMRect-like object */
function rect(top: number, bottom: number): { getBoundingClientRect(): DOMRect } {
  return {
    getBoundingClientRect: () =>
      ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top }) as DOMRect,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("shouldFollowAfterAnchor", () => {
  // Container viewport: top=0, bottom=800 (800px tall)
  const container = rect(0, 800);

  it("returns false when tail is well above the viewport bottom (visible space below)", () => {
    // Response bottom at 400px — 400px of empty space still visible below it
    const tail = rect(0, 400);
    expect(shouldFollowAfterAnchor(container, tail)).toBe(false);
  });

  it("returns false when tail is within the default 24px gap of viewport bottom", () => {
    // 800 - 24 = 776; tail at 775 is still inside the gap threshold
    const tail = rect(0, 775);
    expect(shouldFollowAfterAnchor(container, tail)).toBe(false);
  });

  it("returns false when tail bottom is exactly at the activation boundary", () => {
    // tail.bottom === containerRect.bottom - gap  →  NOT strictly greater
    const tail = rect(0, 776); // 800 - 24 = 776
    expect(shouldFollowAfterAnchor(container, tail)).toBe(false);
  });

  it("returns true when tail bottom just crosses the activation boundary", () => {
    // tail.bottom = 777 > 800 - 24 = 776
    const tail = rect(0, 777);
    expect(shouldFollowAfterAnchor(container, tail)).toBe(true);
  });

  it("returns true when tail is exactly at viewport bottom", () => {
    const tail = rect(0, 800);
    expect(shouldFollowAfterAnchor(container, tail)).toBe(true);
  });

  it("returns true when tail extends beyond the viewport bottom (overflow)", () => {
    // Response has grown past the viewport — follow to keep tail visible
    const tail = rect(0, 950);
    expect(shouldFollowAfterAnchor(container, tail)).toBe(true);
  });

  it("returns true (fallback) when tailEl is null", () => {
    // No element found in DOM yet — default to follow so we don't get stuck
    expect(shouldFollowAfterAnchor(container, null)).toBe(true);
  });

  it("respects a custom gap parameter", () => {
    // gap = 48 → activation at containerRect.bottom - 48 = 752
    const tailBelow = rect(0, 753); // 753 > 752 → follow
    const tailAbove = rect(0, 751); // 751 ≤ 752 → hold
    expect(shouldFollowAfterAnchor(container, tailBelow, 48)).toBe(true);
    expect(shouldFollowAfterAnchor(container, tailAbove, 48)).toBe(false);
  });

  it("handles a viewport with non-zero top offset (e.g. inside a framed layout)", () => {
    // Container: top=200, bottom=1000 (800px visible)
    const offsetContainer = rect(200, 1000);
    // Tail at absolute bottom 1000 → exactly at boundary with gap=24:
    //   containerRect.bottom - 24 = 976 → tail.bottom=976 is NOT > 976
    const tailAtBoundary = rect(200, 976);
    expect(shouldFollowAfterAnchor(offsetContainer, tailAtBoundary)).toBe(false);
    // tail.bottom=977 → 977 > 976 → follow
    const tailPastBoundary = rect(200, 977);
    expect(shouldFollowAfterAnchor(offsetContainer, tailPastBoundary)).toBe(true);
  });

  it("returns false when tail is far above viewport bottom — simulates early streaming", () => {
    // Anchor fired, response just started: only 2 lines of text.
    // tail bottom well inside the visible area.
    const tail = rect(50, 150);
    expect(shouldFollowAfterAnchor(container, tail)).toBe(false);
  });

  it("returns true when tail slightly exceeds viewport — simulates overflow start", () => {
    // Response grew to just past the viewport bottom.
    const tail = rect(50, 810);
    expect(shouldFollowAfterAnchor(container, tail)).toBe(true);
  });

  describe("manual-scroll cancellation guard (conceptual)", () => {
    // shouldFollowAfterAnchor itself is a pure geometry check — the
    // transcriptAutoFollowPausedRef guard upstream prevents it from being
    // called when the user has manually scrolled.  These tests verify the
    // geometry in isolation.
    it("geometry still returns true after overflow even if called without the pause guard", () => {
      const tail = rect(50, 900);
      expect(shouldFollowAfterAnchor(container, tail)).toBe(true);
    });
  });
});
