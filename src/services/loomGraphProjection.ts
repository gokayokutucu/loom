/*
 * Legacy/dev/test-only graph projection after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { Conversation, LoomForkRecord, LoomLink, ResponseItem } from "../types";
import { cleanMarkdownDisplayText } from "./assistantMarkdown";

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
  displayCode?: string;
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
  references?: LoomLink[];
  isActivePath?: boolean;
  isWeftPath?: boolean;
}

export interface LoomGraphProjection {
  nodes: LoomGraphProjectionNode[];
  edges: LoomGraphProjectionEdge[];
  firstNodeId?: string;
  lastNodeId?: string;
  focusedNodeId?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  serviceGraphStatus?: "resolved" | "not_found" | "empty" | "unavailable";
  serviceGraphStoreAuthoritative?: boolean;
  warnings?: string[];
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
  return cleanMarkdownDisplayText(lines.join("\n"));
}

function responseFullContent(response: ResponseItem) {
  return response.answer.join("\n").trim();
}

function nodeTitle(response: ResponseItem) {
  return cleanMarkdownDisplayText(response.meta?.title || response.title) || "Untitled response";
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
  const cleanLines = cleanMarkdownDisplayText(label)
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const normalized =
    cleanLines.length > 1
      ? `${cleanLines[0]} +${cleanLines.length - 1} more`
      : cleanLines[0] ?? "";
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 93).trim()}...`;
}

function isFragmentReference(link: LoomLink) {
  return link.type === "fragment" || Boolean(link.selectedText && link.sourceResponseId);
}

function isAttachedQuoteReference(link: LoomLink) {
  return isFragmentReference(link) && link.badge === "Selection";
}

function cleanGraphQuestionLabel(question: string, references?: LoomLink[]) {
  return (references ?? []).filter(isAttachedQuoteReference).reduce((current, link) => {
    const labels = new Set([
      `[[${link.title}]]`,
      link.referenceCustomLabel ? `[[${link.referenceCustomLabel}]]` : "",
      link.selectedText ? `[[${link.selectedText}]]` : "",
    ]);
    let next = current;
    labels.forEach((label) => {
      if (!label) return;
      next = next.split(label).join(" ");
    });
    return next;
  }, question).trim();
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
  const occupiedSlots = new Set<string>();
  let firstNodeId: string | undefined;
  let lastNodeId: string | undefined;
  let focusedNodeId: string | undefined;

  const branchLaneFor = (
    parentLane: number,
    siblingIndex: number,
    originResponseIndex: number
  ) => {
    const distance = Math.floor(siblingIndex / 2) + 1;
    const outwardDirection =
      parentLane < 0 ? -1 : parentLane > 0 ? 1 : originResponseIndex % 2 === 0 ? -1 : 1;
    const direction = siblingIndex % 2 === 0 ? outwardDirection : -outwardDirection;
    return parentLane + direction * distance;
  };

  const slotKey = (lane: number, depth: number) => `${lane}:${depth}`;

  const pathSlotsAreFree = (lane: number, depth: number, responseCount: number) => {
    for (let offset = 0; offset <= responseCount; offset += 1) {
      if (occupiedSlots.has(slotKey(lane, depth + offset))) return false;
    }
    return true;
  };

  const nearestOpenLane = (
    preferredLane: number,
    depth: number,
    responseCount: number
  ) => {
    if (pathSlotsAreFree(preferredLane, depth, responseCount)) return preferredLane;
    const outwardDirection = preferredLane < 0 ? -1 : 1;
    for (let offset = 1; offset < 24; offset += 1) {
      const outwardLane = preferredLane + outwardDirection * offset;
      if (pathSlotsAreFree(outwardLane, depth, responseCount)) return outwardLane;
      const inwardLane = preferredLane - outwardDirection * offset;
      if (pathSlotsAreFree(inwardLane, depth, responseCount)) return inwardLane;
    }
    return preferredLane;
  };

  const reservePathSlots = (lane: number, depth: number, responseCount: number) => {
    for (let offset = 0; offset <= responseCount; offset += 1) {
      occupiedSlots.add(slotKey(lane, depth + offset));
    }
  };

  const addLoomPath = (
    loom: Conversation,
    preferredLane: number,
    depth: number,
    parentNodeId?: string
  ) => {
    if (visitedLooms.has(loom.id)) return;
    visitedLooms.add(loom.id);
    const responses = responsesByConversation[loom.id] ?? [];
    const lane = nearestOpenLane(preferredLane, depth, responses.length);
    reservePathSlots(lane, depth, responses.length);

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
      title: cleanMarkdownDisplayText(loom.title) || "Untitled Loom",
      code: loom.meta?.code,
      summary: cleanMarkdownDisplayText(loom.summary),
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
        summary: cleanMarkdownDisplayText(response.meta?.summary),
        contentPreview: responsePreview(response, expanded),
        fullContent: responseFullContent(response),
        canonicalUri: responseCanonicalUri(response),
        isAddressable: responseIsAddressable(response),
        isBookmarked:
          response.bookmarked ||
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
        label: truncateLabel(cleanGraphQuestionLabel(response.question, response.questionReferences)),
        references: response.questionReferences,
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
        .forEach((forkRecord, siblingIndex) => {
          const childLoom = conversations.find(
            (conversation) => conversation.id === forkRecord.childConversationId
          );
          if (!childLoom) return;
          const childLane = branchLaneFor(lane, siblingIndex, index);
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
