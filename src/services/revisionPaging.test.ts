import { describe, it, expect } from "vitest";
import { resolveRevisionTarget } from "./revisionPaging";
import type { LoomForkRecord, ResponseItem } from "../types";

describe("resolveRevisionTarget", () => {
  const originConversationId = "loom-main";
  const displayResponseId = "resp-123";

  const revisionRecords: LoomForkRecord[] = [
    {
      id: "rec-1",
      kind: "revision",
      parentConversationId: originConversationId,
      parentResponseId: displayResponseId,
      childConversationId: "loom-rev-1",
      title: "Revision 1",
      createdAt: "2026-06-03T12:00:00Z",
    },
    {
      id: "rec-2",
      kind: "revision",
      parentConversationId: originConversationId,
      parentResponseId: displayResponseId,
      childConversationId: "loom-rev-2",
      title: "Revision 2",
      createdAt: "2026-06-03T13:00:00Z",
    },
  ];

  const parentResponses: ResponseItem[] = [
    { id: displayResponseId, question: "Prompt A", answer: "Response A" } as any,
  ];

  it("should return origin pane and displayResponseId for revisionIndex = 0", () => {
    const result = resolveRevisionTarget({
      revisionIndex: 0,
      displayResponseId,
      originConversationId,
      revisionRecords,
      parentResponses,
      getConversationResponses: () => [],
    });

    expect(result).toEqual({
      pane: "origin",
      loomId: originConversationId,
      targetResponseId: displayResponseId,
    });
  });

  it("should return target revision details for revisionIndex > 0", () => {
    const childResponses = [
      { id: `revision-${displayResponseId}-child`, question: "Prompt B", answer: "Response B" } as any,
    ];
    const result = resolveRevisionTarget({
      revisionIndex: 1, // first revision record (rec-1)
      displayResponseId,
      originConversationId,
      revisionRecords,
      parentResponses,
      getConversationResponses: (id) => (id === "loom-rev-1" ? childResponses : []),
    });

    expect(result).toEqual({
      pane: "weft",
      loomId: "loom-rev-1",
      targetResponseId: `revision-${displayResponseId}-child`,
    });
  });

  it("should fallback to index-matching child response if prefix doesn't match", () => {
    const childResponses = [
      { id: "other-resp-id", question: "Prompt B", answer: "Response B" } as any,
    ];
    const result = resolveRevisionTarget({
      revisionIndex: 1,
      displayResponseId,
      originConversationId,
      revisionRecords,
      parentResponses,
      getConversationResponses: (id) => (id === "loom-rev-1" ? childResponses : []),
    });

    expect(result).toEqual({
      pane: "weft",
      loomId: "loom-rev-1",
      targetResponseId: "other-resp-id",
    });
  });

  it("should return null if revisionIndex is out of bounds", () => {
    const result = resolveRevisionTarget({
      revisionIndex: 99,
      displayResponseId,
      originConversationId,
      revisionRecords,
      parentResponses,
      getConversationResponses: () => [],
    });

    expect(result).toBeNull();
  });
});
