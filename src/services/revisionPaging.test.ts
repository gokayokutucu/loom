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
    {
      id: "rec-3",
      kind: "revision",
      parentConversationId: originConversationId,
      parentResponseId: displayResponseId,
      childConversationId: "loom-rev-3",
      title: "Revision 3",
      createdAt: "2026-06-03T14:00:00Z",
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

  it("should fallback to the first child response if prefix doesn't match", () => {
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

  it("does not use the origin response index inside a revision Loom with follow-up responses", () => {
    const secondParentResponseId = "resp-456";
    const childResponses = [
      { id: "revision-answer", question: "Edited prompt", answer: "Revision answer" } as any,
      { id: "revision-follow-up", question: "Follow-up", answer: "Follow-up answer" } as any,
    ];

    const result = resolveRevisionTarget({
      revisionIndex: 1,
      displayResponseId: secondParentResponseId,
      originConversationId,
      revisionRecords: [
        {
          ...revisionRecords[0],
          parentResponseId: secondParentResponseId,
        },
      ],
      parentResponses: [
        { id: displayResponseId, question: "Prompt A", answer: "Response A" } as any,
        { id: secondParentResponseId, question: "Prompt B", answer: "Response B" } as any,
      ],
      getConversationResponses: (id) => (id === "loom-rev-1" ? childResponses : []),
    });

    expect(result).toEqual({
      pane: "weft",
      loomId: "loom-rev-1",
      targetResponseId: "revision-answer",
    });
  });

  it("should return target revision details for revisionIndex = 2 (index 2)", () => {
    const childResponses = [
      { id: `revision-${displayResponseId}-child2`, question: "Prompt C", answer: "Response C" } as any,
    ];
    const result = resolveRevisionTarget({
      revisionIndex: 2, // second revision record (rec-2)
      displayResponseId,
      originConversationId,
      revisionRecords,
      parentResponses,
      getConversationResponses: (id) => (id === "loom-rev-2" ? childResponses : []),
    });

    expect(result).toEqual({
      pane: "weft",
      loomId: "loom-rev-2",
      targetResponseId: `revision-${displayResponseId}-child2`,
    });
  });

  it("should map 1/3, 2/3, and 3/3 without off-by-one errors", () => {
    const responsesByLoom: Record<string, ResponseItem[]> = {
      "loom-rev-1": [
        { id: `revision-${displayResponseId}-first`, question: "Prompt B", answer: "Response B" } as any,
      ],
      "loom-rev-2": [
        { id: `revision-${displayResponseId}-second`, question: "Prompt C", answer: "Response C" } as any,
      ],
    };

    expect(
      resolveRevisionTarget({
        revisionIndex: 0,
        displayResponseId,
        originConversationId,
        revisionRecords: revisionRecords.slice(0, 2),
        parentResponses,
        getConversationResponses: (id) => responsesByLoom[id] ?? [],
      })
    ).toEqual({
      pane: "origin",
      loomId: originConversationId,
      targetResponseId: displayResponseId,
    });

    expect(
      resolveRevisionTarget({
        revisionIndex: 1,
        displayResponseId,
        originConversationId,
        revisionRecords: revisionRecords.slice(0, 2),
        parentResponses,
        getConversationResponses: (id) => responsesByLoom[id] ?? [],
      })
    ).toEqual({
      pane: "weft",
      loomId: "loom-rev-1",
      targetResponseId: `revision-${displayResponseId}-first`,
    });

    expect(
      resolveRevisionTarget({
        revisionIndex: 2,
        displayResponseId,
        originConversationId,
        revisionRecords: revisionRecords.slice(0, 2),
        parentResponses,
        getConversationResponses: (id) => responsesByLoom[id] ?? [],
      })
    ).toEqual({
      pane: "weft",
      loomId: "loom-rev-2",
      targetResponseId: `revision-${displayResponseId}-second`,
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
