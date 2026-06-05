import { LoomForkRecord, ResponseItem } from "../types";

export interface RevisionTargetResult {
  pane: "origin" | "weft";
  loomId: string;
  targetResponseId: string;
}

/**
 * Resolves the navigation/focus target information for a revision index click.
 *
 * @param options.revisionIndex 0-based index of the counter selection (0 corresponds to 1/x, 1 to 2/x, etc.)
 * @param options.displayResponseId The ID of the original response item in the parent conversation
 * @param options.originConversationId The ID of the parent/origin conversation
 * @param options.revisionRecords All fork records for this parent response where kind is "revision"
 * @param options.parentResponses The list of response items in the parent conversation
 * @param options.getConversationResponses A helper to retrieve responses for a given conversation ID
 */
export function resolveRevisionTarget(options: {
  revisionIndex: number;
  displayResponseId: string;
  originConversationId: string;
  revisionRecords: LoomForkRecord[];
  parentResponses: ResponseItem[];
  getConversationResponses: (loomId: string) => ResponseItem[];
}): RevisionTargetResult | null {
  if (options.revisionIndex === 0) {
    // 1/x maps to the origin pane and the parent response itself
    return {
      pane: "origin",
      loomId: options.originConversationId,
      targetResponseId: options.displayResponseId,
    };
  }

  // 2/x+ maps to a revision record
  const revisionRecord = options.revisionRecords[options.revisionIndex - 1];
  if (!revisionRecord) return null;

  const childLoomId = revisionRecord.childConversationId;
  const childResponses = options.getConversationResponses(childLoomId);

  // Locate the target response item in the child conversation.
  // A Revision page points at the revision Loom's own answer. Do not project the
  // parent response index into the child Loom: the child may already have follow-up
  // responses, and paging 3/x must still highlight the initial revision answer.
  const targetResponse =
    childResponses.find((r) =>
      r.id.startsWith(`revision-${options.displayResponseId}`)
    ) ||
    childResponses[0];

  if (!targetResponse) return null;

  return {
    pane: "weft",
    loomId: childLoomId,
    targetResponseId: targetResponse.id,
  };
}
