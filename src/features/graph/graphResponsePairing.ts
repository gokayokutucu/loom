import type { LoomGraphProjectionNode } from "../../services/loomGraphProjection";
import type { ResponseItem } from "../../types";

export function responseForGraphNode(
  node: LoomGraphProjectionNode,
  responsesByConversation: Record<string, ResponseItem[]>
) {
  if (node.kind !== "response" || !node.responseId) return undefined;
  return (responsesByConversation[node.loomId] ?? []).find(
    (response) =>
      response.id === node.responseId || response.serviceUserResponseId === node.responseId
  );
}

export function responsePairIdsForGraphNode(response: ResponseItem | undefined) {
  return new Set(
    [response?.id, response?.serviceUserResponseId].filter(
      (value): value is string => Boolean(value)
    )
  );
}
