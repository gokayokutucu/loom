/*
 * Legacy/dev/test-only graph projection after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { Conversation, LoomForkRecord, LoomLineageRole, LoomLink, ResponseItem } from "../types";
import { cleanMarkdownDisplayText } from "./assistantMarkdown";
import { polishDisplayTitle } from "./displayTitlePolish";

export type LoomGraphProjectionNodeKind =
  | "root"
  | "loom"
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
  graphRole?:
    | "current-root"
    | "origin-context"
    | "origin-response"
    | "child-response"
    | "child-weft"
    | "ancestor-context"
      | "ancestor-response";
  lineageRole?: LoomLineageRole;
  hasParentAncestry?: boolean;
  ancestryExpanded?: boolean;
  ancestryLoading?: boolean;
  ancestryError?: string;
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

export interface LoomGraphAncestryStep {
  loomId: string;
  hasParentAncestry: boolean;
  parentLoom?: {
    loomId: string;
    title: string;
    summary?: string;
    canonicalUri?: string;
    code?: string;
    displayCode?: string;
    kind?: "loom" | "weft";
    hasParentAncestry?: boolean;
  };
  parentOriginResponse?: {
    responseId: string;
    loomId: string;
    title: string;
    preview?: string;
    canonicalUri?: string;
    code?: string;
    displayCode?: string;
  };
  warnings?: string[];
}

const ANCESTRY_LANE_WIDTH = 360;
const ANCESTRY_ROW_GAP = 300;

function ancestryResponseNodeId(response: LoomGraphAncestryStep["parentOriginResponse"]) {
  return response ? responseGraphNodeId(response.loomId, response.responseId) : undefined;
}

function ancestryLaneFromPositionX(positionX: number) {
  return Math.round(positionX / ANCESTRY_LANE_WIDTH);
}

function ancestryPositionXForLane(lane: number) {
  return lane * ANCESTRY_LANE_WIDTH;
}

function chooseAncestryParentLane(
  projection: LoomGraphProjection,
  anchorNode: LoomGraphProjectionNode | undefined,
  loomDepth: number,
  responseDepth: number
) {
  const anchorLane = anchorNode ? ancestryLaneFromPositionX(anchorNode.position.x) : 0;
  const occupied = new Set(
    projection.nodes
      .filter((node) => node.depth === loomDepth || node.depth === responseDepth)
      .map((node) => ancestryLaneFromPositionX(node.position.x))
  );
  const candidates = [anchorLane - 1, anchorLane + 1];
  for (let offset = 2; offset < 24; offset += 1) {
    candidates.push(anchorLane - offset, anchorLane + offset);
  }
  return candidates.find((lane) => lane !== anchorLane && !occupied.has(lane)) ?? anchorLane - 1;
}

export function mergeLoomGraphAncestryStep(
  projection: LoomGraphProjection,
  anchorLoomNodeId: string,
  step: LoomGraphAncestryStep
): LoomGraphProjection {
  if (!step.parentLoom || !step.parentOriginResponse) {
    return {
      ...projection,
      nodes: projection.nodes.map((node) =>
        node.id === anchorLoomNodeId
          ? { ...node, hasParentAncestry: false, ancestryExpanded: true }
          : node
      ),
      warnings: [...(projection.warnings ?? []), ...(step.warnings ?? [])],
    };
  }

  const parentLoomNodeId = loomGraphRootNodeId(step.parentLoom.loomId);
  const parentResponseNodeId = ancestryResponseNodeId(step.parentOriginResponse);
  if (!parentResponseNodeId) return projection;

  const existingIds = new Set(projection.nodes.map((node) => node.id));
  const anchorNode = projection.nodes.find((node) => node.id === anchorLoomNodeId);
  const anchorDepth = anchorNode?.depth ?? 0;
  const responseDepth = anchorDepth - 1;
  const loomDepth = anchorDepth - 2;
  const parentLane = chooseAncestryParentLane(projection, anchorNode, loomDepth, responseDepth);
  const parentX = ancestryPositionXForLane(parentLane);

  const parentLoomNode: LoomGraphProjectionNode = {
    id: parentLoomNodeId,
    kind: step.parentLoom.kind === "weft" ? "weft" : "loom",
    loomId: step.parentLoom.loomId,
    title: step.parentLoom.title,
    code: step.parentLoom.code,
    displayCode: step.parentLoom.displayCode,
    summary: step.parentLoom.summary,
    contentPreview: step.parentLoom.summary,
    fullContent: step.parentLoom.summary,
    canonicalUri: step.parentLoom.canonicalUri,
    isAddressable: Boolean(step.parentLoom.canonicalUri),
    graphRole: "ancestor-context",
    hasParentAncestry: Boolean(step.parentLoom.hasParentAncestry),
    depth: loomDepth,
    position: {
      x: parentX,
      y: loomDepth * ANCESTRY_ROW_GAP,
    },
  };

  const parentResponseNode: LoomGraphProjectionNode = {
    id: parentResponseNodeId,
    kind: "response",
    loomId: step.parentOriginResponse.loomId,
    responseId: step.parentOriginResponse.responseId,
    title: step.parentOriginResponse.title,
    code: step.parentOriginResponse.code,
    displayCode: step.parentOriginResponse.displayCode,
    summary: step.parentOriginResponse.preview,
    contentPreview: step.parentOriginResponse.preview,
    fullContent: step.parentOriginResponse.preview,
    canonicalUri: step.parentOriginResponse.canonicalUri,
    isAddressable: Boolean(step.parentOriginResponse.canonicalUri),
    graphRole: "ancestor-response",
    depth: responseDepth,
    position: {
      x: parentX,
      y: responseDepth * ANCESTRY_ROW_GAP,
    },
  };

  const nextNodes = projection.nodes.map((node) =>
    node.id === anchorLoomNodeId
      ? { ...node, hasParentAncestry: false, ancestryExpanded: true, ancestryLoading: false }
      : node
  );
  if (!existingIds.has(parentLoomNodeId)) nextNodes.unshift(parentLoomNode);
  if (!existingIds.has(parentResponseNodeId)) {
    const insertIndex = nextNodes.findIndex((node) => node.id === anchorLoomNodeId);
    nextNodes.splice(Math.max(0, insertIndex), 0, parentResponseNode);
  }

  const nextEdges = [...projection.edges];
  const containmentEdgeId = `${parentLoomNodeId}->${parentResponseNodeId}`;
  if (!nextEdges.some((edge) => edge.id === containmentEdgeId)) {
    nextEdges.push({
      id: containmentEdgeId,
      source: parentLoomNodeId,
      target: parentResponseNodeId,
      kind: "question",
      label: "Origin response",
      isActivePath: true,
      isWeftPath: true,
    });
  }
  const originEdgeId = `${parentResponseNodeId}->${anchorLoomNodeId}`;
  if (!nextEdges.some((edge) => edge.id === originEdgeId)) {
    nextEdges.push({
      id: originEdgeId,
      source: parentResponseNodeId,
      target: anchorLoomNodeId,
      kind: "weft",
      label: "Weft origin",
      isActivePath: true,
      isWeftPath: true,
    });
  }

  return {
    ...projection,
    nodes: nextNodes,
    edges: nextEdges,
    firstNodeId: projection.firstNodeId ?? parentResponseNodeId,
    warnings: [...(projection.warnings ?? []), ...(step.warnings ?? [])],
  };
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

/**
 * Returns true when the graph node represents a Loom destination — i.e. it is
 * a persisted, addressable, bookmarkable Loom regardless of whether it is the
 * active ("root") Loom in the current view or a branched ("weft") Loom.
 *
 * Semantic note: "root" and "weft" are both Loom destination nodes.
 * The difference is topology/lineage, not ontology category.
 *
 * Use this instead of repeating `kind === "root" || kind === "weft"` at every
 * action gate.  When a new Loom variant is introduced (revision node, imported
 * Loom, …), update only this predicate.
 */
export function isLoomGraphDestinationNode(node: LoomGraphProjectionNode): boolean {
  return node.kind === "root" || node.kind === "loom" || node.kind === "weft";
}

/**
 * Returns the lineage role of a Loom destination graph node, mirroring
 * `Conversation.lineageRole` at the projection layer.
 *
 * - `"weft"` for branched Loom nodes (kind === "weft")
 * - `undefined` for the active/primary Loom (kind === "root")
 * - `undefined` for Loom context nodes (kind === "loom")
 * - `undefined` for non-Loom nodes (response, bookmark, reference)
 *
 * Use this when code needs to distinguish a weft from a root Loom for
 * semantic reasons (e.g. navigation, badge copy) without coupling to the
 * raw `kind` string.  Visual rendering may continue to check `kind` directly.
 */
export function graphNodeLineageRole(
  node: LoomGraphProjectionNode
): LoomLineageRole | undefined {
  if (node.lineageRole) return node.lineageRole;
  if (node.kind === "weft") return "weft";
  return undefined;
}

/**
 * Returns true when the node is a branched (weft) Loom, as opposed to the
 * active primary Loom or a non-Loom node.
 *
 * This is the graph-layer equivalent of `isWeftConversation(conversation)`.
 * Visual code should continue to use `node.kind === "weft"` directly.
 */
export function isWeftGraphNode(node: LoomGraphProjectionNode): boolean {
  return node.kind === "weft";
}

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
  const title = cleanMarkdownDisplayText(response.meta?.title || response.title);
  return polishDisplayTitle(title) || "Untitled response";
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
      title: polishDisplayTitle(cleanMarkdownDisplayText(loom.title)) || "Untitled Loom",
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
