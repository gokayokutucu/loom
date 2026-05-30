import { describe, expect, it } from "vitest";
import type { BookmarkItem, Conversation } from "../types";
import {
  isRawInternalBookmarkTitle,
  repairHydratedLoomBookmarkTitle,
  resolveLoomBookmarkTitle,
} from "./bookmarkTitleRepair";

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "loom-123",
    title: "How does GPS know where you are",
    path: "loom://how-does-gps-know-where-you-are/L-123",
    folder: "General",
    summary: "GPS explanation",
    meta: {
      id: "meta-loom-123",
      title: "How does GPS know where you are",
      code: "L-123",
      displayCode: "L-123",
      canonicalUri: "loom://how-does-gps-know-where-you-are/L-123",
      keywords: [],
      summary: "GPS explanation",
      usageCount: 0,
      status: "addressable",
    },
    ...overrides,
  };
}

function makeBookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: "bookmark-123",
    type: "conversation",
    title: "c-1779797425749",
    editableTitle: "c-1779797425749",
    path: "loom://how-does-gps-know-where-you-are/L-123",
    badge: "Bookmark",
    targetKind: "loom",
    targetObjectId: "loom-123",
    canonicalUri: "loom://how-does-gps-know-where-you-are/L-123",
    selectedAt: Date.now(),
    lastUsed: "2026-05-28T00:00:00Z",
    ...overrides,
  };
}

describe("bookmark title repair", () => {
  it("detects conservative raw/internal Loom bookmark titles", () => {
    expect(isRawInternalBookmarkTitle("c-1779797425749")).toBe(true);
    expect(isRawInternalBookmarkTitle("weft-response-workflow-1779797425749")).toBe(true);
    expect(isRawInternalBookmarkTitle("loom-123", "loom-123")).toBe(true);
    expect(isRawInternalBookmarkTitle("How does GPS know where you are")).toBe(false);
  });

  it("resolves Loom titles using live Conversation title before raw service title", () => {
    expect(
      resolveLoomBookmarkTitle({
        liveConversationTitle: "How does GPS know where you are",
        serviceTitle: "c-1779797425749",
        path: "loom://how-does-gps-know-where-you-are/L-123",
        fallbackId: "loom-123",
      })
    ).toBe("How does GPS know where you are");
  });

  it("repairs hydrated Loom bookmark title from matching live Conversation", () => {
    const repaired = repairHydratedLoomBookmarkTitle(makeBookmark(), [makeConversation()]);
    expect(repaired.title).toBe("How does GPS know where you are");
    expect(repaired.editableTitle).toBe("How does GPS know where you are");
    expect(repaired.targetObjectId).toBe("loom-123");
  });

  it("repairs hydrated Weft bookmark title from matching live Conversation", () => {
    const repaired = repairHydratedLoomBookmarkTitle(
      makeBookmark({
        title: "weft-response-workflow-1779797425749",
        editableTitle: "weft-response-workflow-1779797425749",
        targetKind: "weft",
        targetObjectId: "weft-456",
        path: "loom://loom-what-problem-does-event-sourcing-solve/L-456",
        canonicalUri: "loom://loom-what-problem-does-event-sourcing-solve/L-456",
      }),
      [
        makeConversation({
          id: "weft-456",
          title: "Loom: What problem does Event Sourcing solve?",
          path: "loom://loom-what-problem-does-event-sourcing-solve/L-456",
          lineageRole: "weft",
          meta: {
            id: "meta-weft-456",
            title: "Loom: What problem does Event Sourcing solve?",
            code: "L-456",
            displayCode: "L-456",
            canonicalUri: "loom://loom-what-problem-does-event-sourcing-solve/L-456",
            keywords: [],
            summary: "Weft explanation",
            usageCount: 0,
            status: "addressable",
          },
        }),
      ]
    );
    expect(repaired.title).toBe("Loom: What problem does Event Sourcing solve?");
    expect(repaired.editableTitle).not.toMatch(/^weft-response-workflow[-_]/i);
  });

  it("does not change response bookmark titles", () => {
    const bookmark = makeBookmark({
      type: "response",
      targetKind: "response",
      title: "c-1779797425749",
      editableTitle: "c-1779797425749",
    });
    expect(repairHydratedLoomBookmarkTitle(bookmark, [makeConversation()])).toBe(bookmark);
  });
});
