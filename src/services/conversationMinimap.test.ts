import { describe, expect, it } from "vitest";
import { responseMinimapItems } from "../components/ConversationScrollMinimap";
import {
  clampPercent,
  conversationMinimapLabel,
  conversationMinimapRevisionLabel,
  MAX_VISIBLE_MINIMAP_RULER_TICKS,
  MINIMAP_RULER_HEIGHT_PX,
  MINIMAP_RULER_TICK_GAP_PX,
  minimapAnchorPercent,
  minimapRulerTickPercent,
  minimapRulerTickTopPx,
  minimapViewportGeometry,
  nearestConversationMinimapItemId,
  visibleMinimapRulerWindow,
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

  it("spaces ruler ticks evenly by item index", () => {
    expect([0, 1, 2, 3].map((index) => minimapRulerTickPercent(index, 4))).toEqual([
      0,
      33.33333333333333,
      66.66666666666666,
      100,
    ]);
    expect(minimapRulerTickPercent(0, 1)).toBe(0);
    expect(minimapRulerTickPercent(10, 4)).toBe(100);
  });

  it("locks compact ruler tick spacing to sixteen pixels", () => {
    expect(MINIMAP_RULER_TICK_GAP_PX).toBe(16);
    expect(MINIMAP_RULER_HEIGHT_PX).toBe(240);
    expect(minimapRulerTickTopPx(0)).toBe(0);
    expect(minimapRulerTickTopPx(1)).toBe(16);
    expect(minimapRulerTickTopPx(10)).toBe(160);
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

  it("normalizes markdown markers before using outline labels", () => {
    expect(
      conversationMinimapLabel({
        type: "response",
        title: ["####", "", "Satellite Requirements"].join("\n"),
      })
    ).toBe("Satellite Requirements");
    expect(
      conversationMinimapLabel({
        type: "user",
        promptText: "**Important** `context`",
      })
    ).toBe("Important context");
  });

  it("derives revision outline labels from prompt, title, and fallback number", () => {
    expect(
      conversationMinimapRevisionLabel(
        { revisionPrompt: ["###", "", "Tighter answer"].join("\n") },
        2
      )
    ).toBe("Tighter answer");
    expect(conversationMinimapRevisionLabel({ title: "**Revision title**" }, 3)).toBe(
      "Revision title"
    );
    expect(conversationMinimapRevisionLabel({}, 2)).toBe("Revision 2");
    expect(conversationMinimapRevisionLabel({}, 1)).toBe("Revision");
  });

  it("derives no revision child rows for responses without revisions", () => {
    expect(
      responseMinimapItems([{ id: "response-a", title: "Answer A", question: "Prompt A" }])[0]
        .outlineChildren
    ).toEqual([]);
  });

  it("derives indented revision child metadata for response revisions", () => {
    const item = responseMinimapItems([
      {
        id: "response-a",
        title: "Answer A",
        question: "Prompt A",
        revisions: [
          {
            id: "fork-1",
            childConversationId: "revision-loom-1",
            revisionPrompt: "Revise tone",
          },
          {
            id: "fork-2",
            childConversationId: "revision-loom-2",
          },
        ],
      },
    ])[0];

    expect(item.outlineChildren).toEqual([
      {
        id: "response-a:revision:fork-1",
        type: "revision",
        label: "Revise tone",
        fullLabel: "Revise tone",
        responseId: "response-a",
        revisionIndex: 1,
        childConversationId: "revision-loom-1",
      },
      {
        id: "response-a:revision:fork-2",
        type: "revision",
        label: "Revision 3",
        fullLabel: "Revision 3",
        responseId: "response-a",
        revisionIndex: 2,
        childConversationId: "revision-loom-2",
      },
    ]);
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

  it("shows all ruler items when the list fits the sixteen pixel window", () => {
    const items = Array.from({ length: MAX_VISIBLE_MINIMAP_RULER_TICKS }, (_, index) => ({
      id: `item-${index}`,
    }));
    expect(visibleMinimapRulerWindow(items, "item-9").map((item) => item.id)).toEqual(
      items.map((item) => item.id)
    );
  });

  it("limits dense ruler items to a centered sixteen pixel window", () => {
    const items = Array.from({ length: 30 }, (_, index) => ({ id: `item-${index}` }));
    const visible = visibleMinimapRulerWindow(items, "item-15");
    expect(visible).toHaveLength(MAX_VISIBLE_MINIMAP_RULER_TICKS);
    expect(visible[0].id).toBe("item-7");
    expect(visible[MAX_VISIBLE_MINIMAP_RULER_TICKS - 1].id).toBe("item-22");
    expect(visible.some((item) => item.id === "item-15")).toBe(true);
  });

  it("clamps dense ruler windows to the start and end", () => {
    const items = Array.from({ length: 30 }, (_, index) => ({ id: `item-${index}` }));
    const topWindow = visibleMinimapRulerWindow(items, "item-2");
    const bottomWindow = visibleMinimapRulerWindow(items, "item-29");

    expect(topWindow).toHaveLength(MAX_VISIBLE_MINIMAP_RULER_TICKS);
    expect(topWindow[0].id).toBe("item-0");
    expect(topWindow[MAX_VISIBLE_MINIMAP_RULER_TICKS - 1].id).toBe("item-15");
    expect(bottomWindow).toHaveLength(MAX_VISIBLE_MINIMAP_RULER_TICKS);
    expect(bottomWindow[0].id).toBe("item-14");
    expect(bottomWindow[MAX_VISIBLE_MINIMAP_RULER_TICKS - 1].id).toBe("item-29");
  });

  it("returns non-truncated normalized labels when truncate option is false", () => {
    const longText = "x".repeat(200);
    const label = conversationMinimapLabel({
      type: "response",
      title: longText,
      truncate: false,
    });
    expect(label).toBe(longText);
    expect(label.endsWith("…")).toBe(false);
  });

  it("populates fullLabel in responseMinimapItems", () => {
    const longText = "y".repeat(150);
    const items = responseMinimapItems([
      {
        id: "res-1",
        title: longText,
        revisions: [
          {
            id: "rev-1",
            childConversationId: "child-1",
            revisionPrompt: "z".repeat(130),
          },
        ],
      },
    ]);
    expect(items[0].label.length).toBeLessThan(150);
    expect(items[0].label.endsWith("…")).toBe(true);
    expect(items[0].fullLabel).toBe(longText);

    const child = items[0].outlineChildren?.[0];
    expect(child).toBeDefined();
    expect(child!.label.length).toBeLessThan(130);
    expect(child!.label.endsWith("…")).toBe(true);
    expect(child!.fullLabel).toBe("z".repeat(130));
  });
});
