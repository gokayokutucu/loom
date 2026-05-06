import type { Conversation, LoomForkRecord, ResponseItem } from "../types";

export type LoomGraphProjectionNodeKind =
  | "root"
  | "response"
  | "weft"
  | "bookmark"
  | "reference";

export type LoomGraphProjectionEdgeKind =
  | "question"
  | "weft"
  | "reference"
  | "bookmark"
  | "derived";

export interface LoomGraphProjectionNode {
  id: string;
  kind: LoomGraphProjectionNodeKind;
  loomId: string;
  responseId?: string;
  title: string;
  code?: string;
  summary?: string;
  contentPreview?: string;
  fullContent?: string;
  canonicalUri?: string;
  isAddressable?: boolean;
  isBookmarked?: boolean;
  isFocused?: boolean;
  isExpanded?: boolean;
  depth: number;
  position: {
    x: number;
    y: number;
  };
}

export interface LoomGraphProjectionEdge {
  id: string;
  source: string;
  target: string;
  kind: LoomGraphProjectionEdgeKind;
  label?: string;
  isActivePath?: boolean;
  isWeftPath?: boolean;
}

export interface LoomGraphProjection {
  nodes: LoomGraphProjectionNode[];
  edges: LoomGraphProjectionEdge[];
  firstNodeId?: string;
  lastNodeId?: string;
  focusedNodeId?: string;
}

export interface BuildLoomGraphProjectionInput {
  conversations: Conversation[];
  responsesByConversation: Record<string, ResponseItem[]>;
  forkRecords: LoomForkRecord[];
  activeLoomId?: string;
  focusedResponseId?: string;
  expandedNodeIds?: ReadonlySet<string>;
  bookmarkedResponseAddresses?: ReadonlySet<string>;
}

const ROOT_X = 0;
const ROOT_Y = 0;
const LANE_WIDTH = 460;
const ROW_GAP = 340;
const WEFT_EDGE_LABEL = "Weft from here";

export function loomGraphRootNodeId(loomId: string) {
  return `loom:${loomId}:root`;
}

export function responseGraphNodeId(loomId: string, responseId: string) {
  return `loom:${loomId}:response:${responseId}`;
}

function responsePreview(response: ResponseItem, expanded: boolean) {
  const lines = expanded ? response.answer : response.answer.slice(0, 2);
  return lines.join("\n").trim();
}

function responseFullContent(response: ResponseItem) {
  return response.answer.join("\n").trim();
}

function nodeTitle(response: ResponseItem) {
  return response.meta?.title || response.title || "Untitled response";
}

function responseCode(response: ResponseItem) {
  return response.meta?.code;
}

function responseCanonicalUri(response: ResponseItem) {
  return response.meta?.canonicalUri;
}

function responseIsAddressable(response: ResponseItem) {
  return response.meta?.status === "addressable" || Boolean(response.meta?.canonicalUri);
}

function truncateLabel(label: string | undefined) {
  if (!label) return undefined;
  const normalized = label.replace(/\s+/g, " ").trim();
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 93).trim()}...`;
}

export function buildLoomGraphProjection({
  conversations,
  responsesByConversation,
  forkRecords,
  activeLoomId,
  focusedResponseId,
  expandedNodeIds = new Set<string>(),
  bookmarkedResponseAddresses = new Set<string>(),
}: BuildLoomGraphProjectionInput): LoomGraphProjection {
  const activeLoom =
    conversations.find((conversation) => conversation.id === activeLoomId) ??
    conversations[0];
  if (!activeLoom) {
    return { nodes: [], edges: [] };
  }

  const nodes: LoomGraphProjectionNode[] = [];
  const edges: LoomGraphProjectionEdge[] = [];
  const visitedLooms = new Set<string>();
  let nextBranchLane = 1;
  let firstNodeId: string | undefined;
  let lastNodeId: string | undefined;
  let focusedNodeId: string | undefined;

  const allocateBranchLane = () => {
    const lane =
      nextBranchLane % 2 === 1
        ? Math.ceil(nextBranchLane / 2)
        : -nextBranchLane / 2;
    nextBranchLane += 1;
    return lane;
  };

  const addLoomPath = (
    loom: Conversation,
    lane: number,
    depth: number,
    parentNodeId?: string
  ) => {
    if (visitedLooms.has(loom.id)) return;
    visitedLooms.add(loom.id);

    const rootNodeId = loomGraphRootNodeId(loom.id);
    const x = lane === 0 ? ROOT_X : lane * LANE_WIDTH;
    const rootY = depth * ROW_GAP;
    const isActiveRoot = loom.id === activeLoom.id;
    const isWeftPath =
      Boolean(parentNodeId) ||
      forkRecords.some((forkRecord) => forkRecord.childConversationId === loom.id);
    nodes.push({
      id: rootNodeId,
      kind: isActiveRoot ? "root" : "weft",
      loomId: loom.id,
      title: loom.title,
      code: loom.meta?.code,
      summary: loom.summary,
      canonicalUri: loom.meta?.canonicalUri,
      isAddressable: Boolean(loom.meta?.canonicalUri),
      isFocused: isActiveRoot && !focusedResponseId,
      depth,
      position: { x, y: rootY },
    });

    if (parentNodeId) {
      edges.push({
        id: `${parentNodeId}->${rootNodeId}`,
        source: parentNodeId,
        target: rootNodeId,
        kind: "weft",
        label: WEFT_EDGE_LABEL,
        isActivePath: loom.id === activeLoom.id,
        isWeftPath: true,
      });
    }

    const responses = responsesByConversation[loom.id] ?? [];
    let previousNodeId = rootNodeId;
    responses.forEach((response, index) => {
      const nodeId = responseGraphNodeId(loom.id, response.id);
      const expanded = expandedNodeIds.has(nodeId);
      const nodeDepth = depth + index + 1;
      const y = nodeDepth * ROW_GAP;
      const isFocused = response.id === focusedResponseId;
      if (!firstNodeId) firstNodeId = nodeId;
      lastNodeId = nodeId;
      if (isFocused) focusedNodeId = nodeId;

      nodes.push({
        id: nodeId,
        kind: "response",
        loomId: loom.id,
        responseId: response.id,
        title: nodeTitle(response),
        code: responseCode(response),
        summary: response.meta?.summary,
        contentPreview: responsePreview(response, expanded),
        fullContent: responseFullContent(response),
        canonicalUri: responseCanonicalUri(response),
        isAddressable: responseIsAddressable(response),
        isBookmarked:
          Boolean(response.bookmarked) ||
          bookmarkedResponseAddresses.has(response.address) ||
          (response.meta?.canonicalUri
            ? bookmarkedResponseAddresses.has(response.meta.canonicalUri)
            : false),
        isFocused,
        isExpanded: expanded,
        depth: nodeDepth,
        position: { x, y },
      });

      edges.push({
        id: `${previousNodeId}->${nodeId}`,
        source: previousNodeId,
        target: nodeId,
        kind: index === 0 ? "question" : "derived",
        label: truncateLabel(response.question),
        isActivePath: loom.id === activeLoom.id,
        isWeftPath,
      });
      previousNodeId = nodeId;

      forkRecords
        .filter(
          (forkRecord) =>
            forkRecord.parentConversationId === loom.id &&
            forkRecord.parentResponseId === response.id
        )
        .forEach((forkRecord) => {
          const childLoom = conversations.find(
            (conversation) => conversation.id === forkRecord.childConversationId
          );
          if (!childLoom) return;
          const childLane = allocateBranchLane();
          addLoomPath(childLoom, childLane, nodeDepth + 1, nodeId);
        });
    });
  };

  addLoomPath(activeLoom, 0, ROOT_Y);

  return {
    nodes,
    edges,
    firstNodeId,
    lastNodeId,
    focusedNodeId,
  };
}
