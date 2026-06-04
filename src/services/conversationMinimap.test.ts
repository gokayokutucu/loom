import { describe, expect, it } from "vitest";
import {
  clampPercent,
  conversationMinimapLabel,
  minimapAnchorPercent,
  minimapViewportGeometry,
  nearestConversationMinimapItemId,
} from "./conversationMinimap";

describe("conversation minimap geometry", () => {
  it("converts anchor offsets to percentages", () => {
    expect(minimapAnchorPercent(250, 1000)).toBe(25);
    expect(minimapAnchorPercent(1000, 1000)).toBe(100);
  });

  it("computes viewport thumb geometry", () => {
    expect(
      minimapViewportGeometry({ scrollTop: 250, clientHeight: 250, scrollHeight: 1000 })
    ).toEqual({ topPercent: 25, heightPercent: 25 });
  });

  it("clamps viewport thumb to the track", () => {
    expect(
      minimapViewportGeometry({ scrollTop: 950, clientHeight: 250, scrollHeight: 1000 })
        .topPercent
    ).toBe(75);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-20)).toBe(0);
  });

  it("handles short transcripts without division errors", () => {
    expect(
      minimapViewportGeometry({ scrollTop: 0, clientHeight: 1000, scrollHeight: 500 })
    ).toEqual({ topPercent: 0, heightPercent: 100 });
    expect(minimapAnchorPercent(10, 0)).toBe(0);
  });

  it("handles dense item lists with stable small percentages", () => {
    const values = Array.from({ length: 50 }, (_, index) =>
      minimapAnchorPercent(index * 20, 1000)
    );
    expect(values[0]).toBe(0);
    expect(values[49]).toBe(98);
  });

  it("derives labels from title, prompt, text, and fallback", () => {
    expect(
      conversationMinimapLabel({
        type: "response",
        title: "  Response title  ",
        promptText: "Prompt text",
      })
    ).toBe("Response title");
    expect(
      conversationMinimapLabel({
        type: "user",
        promptText: "Prompt\nwith  spacing",
      })
    ).toBe("Prompt with spacing");
    expect(conversationMinimapLabel({ type: "user", promptText: " " })).toBe(
      "User message"
    );
    expect(conversationMinimapLabel({ type: "response", responseText: "Answer" })).toBe(
      "Answer"
    );
  });

  it("keeps long labels bounded for outline rows", () => {
    const label = conversationMinimapLabel({
      type: "response",
      title: "x".repeat(200),
    });
    expect(label.length).toBeLessThanOrEqual(120);
    expect(label.endsWith("…")).toBe(true);
  });

  it("selects the nearest item by scroll position", () => {
    expect(
      nearestConversationMinimapItemId(
        [
          { id: "a", anchorTop: 0 },
          { id: "b", anchorTop: 500 },
          { id: "c", anchorTop: 900 },
        ],
        620
      )
    ).toBe("b");
    expect(nearestConversationMinimapItemId([], 200)).toBeNull();
  });
});
