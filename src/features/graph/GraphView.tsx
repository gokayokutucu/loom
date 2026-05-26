import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bookmark,
  Bot,
  ExternalLink,
  GitBranch,
  GitFork,
  Link2,
  LocateFixed,
  X,
} from "lucide-react";
import {
  loomGraphRootNodeId,
  responseGraphNodeId,
  type LoomGraphProjectionNode,
  type LoomGraphProjection,
} from "../../services/loomGraphProjection";
import type { Conversation, LoomForkRecord, ResponseItem } from "../../types";
import type { LoomEngineClient } from "../../engine";
import { AssistantMarkdownContent } from "../../components/AssistantMarkdownContent";
import { formatRelativeTimestamp } from "../../services/timeLabels";
import { GraphControls } from "./GraphControls";
import {
  responseForGraphNode,
  responsePairIdsForGraphNode,
} from "./graphResponsePairing";
import { graphResponsePreviewForNode } from "./graphNodePreview";
import { LoomGraphEdge, type LoomGraphFlowEdge } from "./LoomGraphEdge";
import { LoomGraphNode, type LoomGraphFlowNode } from "./LoomGraphNode";
import {
  compactGraphNodePositions,
  GRAPH_FALLBACK_NODE_HEIGHT,
  GRAPH_NODE_VERTICAL_GAP,
} from "./graphLayout";

export interface GraphViewProps {
  engineClient: LoomEngineClient;
  conversations: Conversation[];
  responsesByConversation: Record<string, ResponseItem[]>;
  forkRecords: LoomForkRecord[];
  activeLoomId?: string;
  focusedResponseId?: string;
  focusedWeftLoomId?: string | null;
  bookmarkedResponseAddresses: ReadonlySet<string>;
  onOpenLoom: (loomId: string) => void;
  onOpenResponse: (loomId: string, response: ResponseItem) => void;
  onBookmarkResponse: (
    loomId: string,
    response: ResponseItem,
    currentlyBookmarked?: boolean
  ) => void;
  onBookmarkLoom?: (loomId: string, currentlyBookmarked: boolean) => void;
  onLinkResponse: (loomId: string, response: ResponseItem) => void;
  onLinkLoom?: (loomId: string) => void;
  onWeftResponse: (loomId: string, response: ResponseItem) => void;
  renderContinuationComposer: (props: {
    loomId: string;
    onSubmitStart: () => void;
    onResponseCreated: (response: ResponseItem) => void;
    onResponseCompleted: (response: ResponseItem) => void;
  }) => ReactNode;
}

const edgeTypes: EdgeTypes = {
  loomGraphEdge: LoomGraphEdge,
};

const GRAPH_DEFAULT_ZOOM = 1.08;
const GRAPH_FOCUS_TOP_OFFSET = 20;
const GRAPH_NODE_WIDTH = 292;
const GRAPH_COMPOSER_WIDTH = 620;
const GRAPH_COMPOSER_NODE_GAP = 60;
const GRAPH_PREVIEW_QUESTION_COLLAPSE_LINES = 10;

interface LoomGraphComposerNodeData extends Record<string, unknown> {
  content: ReactNode;
  onClose: () => void;
}

type LoomGraphComposerFlowNode = Node<
  LoomGraphComposerNodeData,
  "loomGraphComposerNode"
>;

type LoomGraphAnyNode = LoomGraphFlowNode | LoomGraphComposerFlowNode;

interface GraphContinuationTarget {
  loomId: string;
  response: ResponseItem;
  nodeId: string;
}

interface GraphRevisionVariant {
  id: string;
  loomId?: string;
  title: string;
  response?: ResponseItem;
}

function graphRevisionSelectionKey(node: LoomGraphProjectionNode) {
  return node.responseId ?? node.id;
}

function revisionDisplayResponse(
  record: LoomForkRecord,
  responsesByConversation: Record<string, ResponseItem[]>
) {
  const responses = responsesByConversation[record.childConversationId] ?? [];
  const response =
    responses.find(
      (item) =>
        item.finalContent?.trim() ||
        item.answer.some((part) => part.trim()) ||
        item.question.trim()
    ) ?? responses[0];
  if (!response) return undefined;
  const revisionPrompt = record.revisionPrompt?.trim();
  if (!revisionPrompt) return response;
  return {
    ...response,
    question: revisionPrompt,
    title: revisionPrompt,
  };
}

function graphRevisionVariantsForResponse(
  node: LoomGraphProjectionNode,
  response: ResponseItem | undefined,
  revisionRecords: LoomForkRecord[],
  responsesByConversation: Record<string, ResponseItem[]>
): GraphRevisionVariant[] {
  if (node.kind !== "response") return [];
  const originalTitle = response?.question?.trim() || node.title;
  return [
    {
      id: "original",
      title: originalTitle,
      response,
    },
    ...revisionRecords.map((record) => {
      const revisionResponse = revisionDisplayResponse(record, responsesByConversation);
      return {
        id: record.childConversationId,
        loomId: record.childConversationId,
        title:
          record.revisionPrompt?.trim() ||
          revisionResponse?.question?.trim() ||
          record.title,
        response: revisionResponse,
      };
    }),
  ];
}

function LoomGraphComposerNode({ data }: NodeProps<LoomGraphComposerFlowNode>) {
  const composerNodeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const focusEditor = () => {
      const editor =
        composerNodeRef.current?.querySelector<HTMLElement>(".prompt-editor");
      if (!editor || editor.textContent?.trim()) return;
      editor.focus();
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(focusEditor);
    });
    const timeouts = [
      window.setTimeout(focusEditor, 80),
      window.setTimeout(focusEditor, 620),
      window.setTimeout(focusEditor, 900),
    ];
    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, []);

  return (
    <section
      ref={composerNodeRef}
      className="loom-graph-composer-node nodrag nopan nowheel"
      aria-label="Graph composer"
      data-testid="graph-continuation-composer"
    >
      <Handle
        type="target"
        position={Position.Top}
        className="loom-graph-handle"
        isConnectable={false}
      />
      <button
        type="button"
        className="loom-graph-continuation-close"
        onClick={data.onClose}
        aria-label="Close Continue Loom composer"
        title="Close"
      >
        <X size={15} />
      </button>
      {data.content}
    </section>
  );
}

function GraphResponsePreviewQuestion({ question }: { question: string }) {
  const questionRef = useRef<HTMLParagraphElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [question]);

  useLayoutEffect(() => {
    const element = questionRef.current;
    if (!element) return;

    function measure() {
      if (!element) return;
      const overflowing = element.scrollHeight > element.clientHeight + 2;
      setCollapsible((current) => (expanded ? current || overflowing : overflowing));
    }

    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(element);
    return () => resizeObserver?.disconnect();
  }, [question, expanded]);

  return (
    <div
      className="graph-response-preview-question-content"
      data-expanded={expanded ? "true" : "false"}
    >
      <p
        ref={questionRef}
        className={expanded ? undefined : "is-clamped"}
        style={
          expanded
            ? undefined
            : ({
                "--graph-preview-question-clamp-lines":
                  GRAPH_PREVIEW_QUESTION_COLLAPSE_LINES,
              } as CSSProperties)
        }
      >
        {question}
      </p>
      {collapsible && (
        <button
          type="button"
          className="graph-response-preview-question-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "Show full message"}
        </button>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  loomGraphNode: LoomGraphNode,
  loomGraphComposerNode: LoomGraphComposerNode,
};

function selectedNodeIdForProjection(projection: LoomGraphProjection) {
  return projection.focusedNodeId ?? projection.lastNodeId ?? projection.firstNodeId;
}

function responseBookmarkCandidates(
  response: ResponseItem | undefined,
  node?: LoomGraphProjectionNode
) {
  return [
    response?.id,
    response?.serviceUserResponseId,
    response?.meta?.id,
    response?.address,
    response?.meta?.canonicalUri,
    node?.responseId,
    node?.canonicalUri,
  ].filter((value): value is string => Boolean(value));
}

function responseIsBookmarkedBySet(
  response: ResponseItem | undefined,
  node: LoomGraphProjectionNode,
  bookmarkedResponseAddresses: ReadonlySet<string>
) {
  return responseBookmarkCandidates(response, node).some((candidate) =>
    bookmarkedResponseAddresses.has(candidate)
  );
}

function GraphViewInner({
  engineClient,
  conversations,
  responsesByConversation,
  forkRecords,
  activeLoomId,
  focusedResponseId,
  focusedWeftLoomId,
  bookmarkedResponseAddresses,
  onOpenLoom,
  onOpenResponse,
  onBookmarkResponse,
  onBookmarkLoom,
  onLinkResponse,
  onLinkLoom,
  onWeftResponse,
  renderContinuationComposer,
}: GraphViewProps) {
  const reactFlow = useReactFlow<LoomGraphAnyNode, LoomGraphFlowEdge>();
  const graphShellRef = useRef<HTMLDivElement | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [followLoomScroll, setFollowLoomScroll] = useState(true);
  const [continuationNodeId, setContinuationNodeId] = useState<string | undefined>(undefined);
  const [continuationTarget, setContinuationTarget] =
    useState<GraphContinuationTarget | null>(null);
  const [continuationOpen, setContinuationOpen] = useState(false);
  const [bookmarkStateOverrides, setBookmarkStateOverrides] = useState<Record<string, boolean>>({});
  const [pendingContinuationFocusNodeId, setPendingContinuationFocusNodeId] = useState<
    string | undefined
  >(undefined);
  const [pendingWeftFocusNodeId, setPendingWeftFocusNodeId] = useState<
    string | undefined
  >(undefined);
  const [graphZoom, setGraphZoom] = useState(GRAPH_DEFAULT_ZOOM);
  const [continuationComposerPosition, setContinuationComposerPosition] = useState({
    x: 0,
    y: 0,
  });
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const [responsePreviewNodeId, setResponsePreviewNodeId] = useState<string | null>(null);
  const [responsePreviewWeftPickerOpen, setResponsePreviewWeftPickerOpen] = useState(false);
  const [selectedGraphRevisionByResponseId, setSelectedGraphRevisionByResponseId] =
    useState<Record<string, number>>({});
  const [nodeHeights, setNodeHeights] = useState<Record<string, number>>({});
  const initializedViewportKey = useRef<string | undefined>(undefined);
  const skipNextFollowAfterWeftFocusRef = useRef(false);
  const skipNextFollowAfterContinuationFocusRef = useRef(false);

  const [projection, setProjection] = useState<LoomGraphProjection>({ nodes: [], edges: [] });
  const conversationTitlesById = useMemo(
    () =>
      Object.fromEntries(
        conversations.map((conversation) => [conversation.id, conversation.title])
      ),
    [conversations]
  );
  const displayForkRecord = useCallback(
    (record: LoomForkRecord): LoomForkRecord => ({
      ...record,
      title: conversationTitlesById[record.childConversationId] ?? record.title,
    }),
    [conversationTitlesById]
  );

  const compactNodePositions = useMemo(
    () => compactGraphNodePositions(projection.nodes, nodeHeights),
    [nodeHeights, projection.nodes]
  );

  const graphNodeRenderPosition = useCallback(
    (node: LoomGraphProjectionNode) =>
      compactNodePositions[node.id] ?? node.position,
    [compactNodePositions]
  );

  useLayoutEffect(() => {
    const shell = graphShellRef.current;
    if (!shell || projection.nodes.length === 0) return;
    const zoom = reactFlow.getZoom() || graphZoom || GRAPH_DEFAULT_ZOOM;
    const measuredEntries = projection.nodes
      .map((node) => {
        const element = shell.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(node.id)}"] .loom-graph-node`
        );
        const measuredHeight = element
          ? element.getBoundingClientRect().height / zoom
          : undefined;
        return measuredHeight && measuredHeight > 0
          ? ([node.id, Math.ceil(measuredHeight)] as const)
          : undefined;
      })
      .filter((entry): entry is readonly [string, number] => Boolean(entry));
    if (measuredEntries.length === 0) return;
    const nextHeights = Object.fromEntries(measuredEntries);
    setNodeHeights((current) => {
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextHeights);
      const changed =
        currentKeys.length !== nextKeys.length ||
        nextKeys.some((key) => current[key] !== nextHeights[key]);
      return changed ? nextHeights : current;
    });
  });

  useEffect(() => {
    let cancelled = false;
    void engineClient
      .getGraphProjection({
        conversations,
        responsesByConversation,
        forkRecords,
        activeLoomId,
        focusedResponseId,
        expandedNodeIds: Array.from(expandedNodeIds),
        bookmarkedResponseAddresses: Array.from(bookmarkedResponseAddresses),
      })
      .then((nextProjection) => {
        if (!cancelled) {
          setProjection(nextProjection);
          setProjectionError(null);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProjection({ nodes: [], edges: [] });
        setProjectionError(
          error instanceof Error
            ? error.message
            : "Graph projection is not available for this Loom."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    engineClient,
    conversations,
    responsesByConversation,
    forkRecords,
    activeLoomId,
    focusedResponseId,
    expandedNodeIds,
    bookmarkedResponseAddresses,
  ]);

  const centerNode = useCallback(
    (nodeId: string | undefined) => {
      if (!nodeId) return;
      const node = projection.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      const position = graphNodeRenderPosition(node);
      reactFlow.setCenter(position.x + 150, position.y + 80, {
        zoom: GRAPH_DEFAULT_ZOOM,
        duration: 420,
      });
      setSelectedNodeId(nodeId);
    },
    [graphNodeRenderPosition, projection.nodes, reactFlow]
  );

  const focusNodeNearTop = useCallback(
    (nodeId: string | undefined, duration = 0) => {
      if (!nodeId) return;
      const node = projection.nodes.find((item) => item.id === nodeId);
      const shell = graphShellRef.current;
      if (!node || !shell) return;
      const width = shell.clientWidth;
      if (width <= 0) {
        centerNode(nodeId);
        return;
      }
      const position = graphNodeRenderPosition(node);
      reactFlow.setViewport(
        {
          x:
            width / 2 -
            (position.x + GRAPH_NODE_WIDTH / 2) * GRAPH_DEFAULT_ZOOM,
          y: GRAPH_FOCUS_TOP_OFFSET - position.y * GRAPH_DEFAULT_ZOOM,
          zoom: GRAPH_DEFAULT_ZOOM,
        },
        { duration }
      );
      setSelectedNodeId(nodeId);
    },
    [centerNode, graphNodeRenderPosition, projection.nodes, reactFlow]
  );

  const positionContinuationComposer = useCallback((nodeId: string | undefined) => {
    const projectionNode = projection.nodes.find((item) => item.id === nodeId);
    if (!nodeId || !projectionNode) return;
    const shell = graphShellRef.current;
    const zoom = reactFlow.getZoom() || GRAPH_DEFAULT_ZOOM;
    const nodeElement = shell?.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${CSS.escape(nodeId)}"] .loom-graph-node`
    );
    const measuredHeight = nodeElement
      ? nodeElement.getBoundingClientRect().height / zoom
      : GRAPH_FALLBACK_NODE_HEIGHT;
    const position = graphNodeRenderPosition(projectionNode);
    setContinuationComposerPosition({
      x: position.x + (GRAPH_NODE_WIDTH - GRAPH_COMPOSER_WIDTH) / 2,
      y: position.y + measuredHeight + GRAPH_COMPOSER_NODE_GAP / zoom,
    });
  }, [graphNodeRenderPosition, projection.nodes, reactFlow]);

  const latestActiveResponse = useMemo(() => {
    if (!activeLoomId) return undefined;
    const responses = responsesByConversation[activeLoomId] ?? [];
    const response = responses[responses.length - 1];
    if (!response) return undefined;
    return {
      loomId: activeLoomId,
      response,
      nodeId: responseGraphNodeId(activeLoomId, response.id),
    };
  }, [activeLoomId, responsesByConversation]);

  const latestActiveResponseNodeIds = useMemo(
    () => responsePairIdsForGraphNode(latestActiveResponse?.response),
    [latestActiveResponse]
  );

  useEffect(() => {
    const nextNodeId = selectedNodeIdForProjection(projection);
    setSelectedNodeId((current) => current ?? nextNodeId);
  }, [projection]);

  useEffect(() => {
    const nextNodeId = selectedNodeIdForProjection(projection);
    const viewportKey = [
      activeLoomId ?? "no-active-loom",
      projection.firstNodeId ?? "no-first-node",
      projection.lastNodeId ?? "no-last-node",
      projection.focusedNodeId ?? "no-focused-node",
    ].join(":");
    if (!viewportKey || initializedViewportKey.current === viewportKey) return;
    initializedViewportKey.current = viewportKey;
    setSelectedNodeId(nextNodeId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => centerNode(nextNodeId));
    });
  }, [activeLoomId, centerNode, projection]);

  useEffect(() => {
    if (focusedWeftLoomId) return;
    if (pendingContinuationFocusNodeId) return;
    if (skipNextFollowAfterWeftFocusRef.current) {
      skipNextFollowAfterWeftFocusRef.current = false;
      return;
    }
    if (skipNextFollowAfterContinuationFocusRef.current) {
      skipNextFollowAfterContinuationFocusRef.current = false;
      return;
    }
    if (!followLoomScroll) return;
    const focusedNodeId =
      projection.focusedNodeId ??
      (activeLoomId && focusedResponseId
        ? responseGraphNodeId(activeLoomId, focusedResponseId)
        : undefined);
    if (focusedNodeId) centerNode(focusedNodeId);
  }, [
    activeLoomId,
    centerNode,
    focusedResponseId,
    focusedWeftLoomId,
    followLoomScroll,
    pendingContinuationFocusNodeId,
    projection.focusedNodeId,
  ]);

  useEffect(() => {
    if (!focusedWeftLoomId) return;
    setContinuationOpen(false);
    setContinuationNodeId(undefined);
    setPendingContinuationFocusNodeId(undefined);
    const weftNodeId = loomGraphRootNodeId(focusedWeftLoomId);
    setSelectedNodeId(weftNodeId);
    if (!projection.nodes.some((node) => node.id === weftNodeId)) {
      setPendingWeftFocusNodeId(weftNodeId);
      return;
    }
    skipNextFollowAfterWeftFocusRef.current = true;
    window.requestAnimationFrame(() => focusNodeNearTop(weftNodeId, 520));
  }, [focusedWeftLoomId, focusNodeNearTop, projection.nodes]);

  useEffect(() => {
    if (!pendingWeftFocusNodeId) return;
    if (!projection.nodes.some((node) => node.id === pendingWeftFocusNodeId)) {
      return;
    }
    skipNextFollowAfterWeftFocusRef.current = true;
    window.requestAnimationFrame(() => {
      focusNodeNearTop(pendingWeftFocusNodeId, 520);
      setPendingWeftFocusNodeId(undefined);
    });
  }, [focusNodeNearTop, pendingWeftFocusNodeId, projection.nodes]);

  useEffect(() => {
    if (!continuationOpen || !continuationNodeId) return;
    window.requestAnimationFrame(() => {
      focusNodeNearTop(continuationNodeId, 520);
      window.requestAnimationFrame(() => positionContinuationComposer(continuationNodeId));
    });
  }, [
    continuationNodeId,
    continuationOpen,
    focusNodeNearTop,
    positionContinuationComposer,
    projection.nodes,
  ]);

  useEffect(() => {
    if (!pendingContinuationFocusNodeId) return;
    if (!projection.nodes.some((node) => node.id === pendingContinuationFocusNodeId)) {
      return;
    }
    skipNextFollowAfterContinuationFocusRef.current = true;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusNodeNearTop(pendingContinuationFocusNodeId, 520);
        setPendingContinuationFocusNodeId(undefined);
      });
    });
  }, [focusNodeNearTop, pendingContinuationFocusNodeId, projection.nodes]);

  useEffect(() => {
    if (!continuationOpen) return;
    const focusEditor = () => {
      const editor = graphShellRef.current?.querySelector<HTMLElement>(
        ".loom-graph-composer-node .prompt-editor"
      );
      if (!editor || editor.textContent?.trim()) return;
      editor.focus();
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(focusEditor));
    const timeouts = [
      window.setTimeout(focusEditor, 120),
      window.setTimeout(focusEditor, 640),
      window.setTimeout(focusEditor, 920),
    ];
    return () => {
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [continuationOpen, continuationNodeId]);

  useEffect(() => {
    setContinuationOpen(false);
    setContinuationNodeId(undefined);
    setContinuationTarget(null);
    setPendingContinuationFocusNodeId(undefined);
    setPendingWeftFocusNodeId(undefined);
    setResponsePreviewNodeId(null);
    setResponsePreviewWeftPickerOpen(false);
    setBookmarkStateOverrides({});
  }, [activeLoomId]);

  const bookmarkOverrideForResponse = useCallback(
    (response: ResponseItem | undefined) => {
      if (!response) return undefined;
      for (const responseId of responsePairIdsForGraphNode(response)) {
        const override = bookmarkStateOverrides[responseId];
        if (override !== undefined) return override;
      }
      return undefined;
    },
    [bookmarkStateOverrides]
  );

  const setBookmarkOverrideForResponse = useCallback(
    (response: ResponseItem, bookmarked: boolean) => {
      const updates = Object.fromEntries(
        Array.from(responsePairIdsForGraphNode(response)).map((responseId) => [
          responseId,
          bookmarked,
        ])
      );
      setBookmarkStateOverrides((current) => ({ ...current, ...updates }));
    },
    []
  );

  useEffect(() => {
    if (!responsePreviewNodeId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setResponsePreviewNodeId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [responsePreviewNodeId]);

  useEffect(() => {
    setResponsePreviewWeftPickerOpen(false);
  }, [responsePreviewNodeId]);

  const responsePreview = useMemo(() => {
    if (!responsePreviewNodeId) return null;
    const node = projection.nodes.find((item) => item.id === responsePreviewNodeId);
    if (!node) return null;
    const response = responseForGraphNode(node, responsesByConversation);
    const responsePairIds = responsePairIdsForGraphNode(response);
    const revisionRecords = forkRecords.filter(
      (record) =>
        record.kind === "revision" &&
        record.parentConversationId === node.loomId &&
        Boolean(node.responseId) &&
        (record.parentResponseId === node.responseId ||
          responsePairIds.has(record.parentResponseId))
    );
    const revisionVariants = graphRevisionVariantsForResponse(
      node,
      response,
      revisionRecords,
      responsesByConversation
    );
    const selectedRevisionIndex = Math.min(
      selectedGraphRevisionByResponseId[node.responseId ?? ""] ?? 0,
      Math.max(0, revisionVariants.length - 1)
    );
    const activeVariant = revisionVariants[selectedRevisionIndex];
    return graphResponsePreviewForNode(
      activeVariant
        ? {
            ...node,
            title: activeVariant.title,
          }
        : node,
      activeVariant?.response ?? response
    );
  }, [
    forkRecords,
    projection.nodes,
    responsePreviewNodeId,
    responsesByConversation,
    selectedGraphRevisionByResponseId,
  ]);

  const responsePreviewTarget = useMemo(() => {
    if (!responsePreviewNodeId) return null;
    const node = projection.nodes.find((item) => item.id === responsePreviewNodeId);
    if (!node || node.kind !== "response") return null;
    const response = responseForGraphNode(node, responsesByConversation);
    if (!response) return null;
    const isBookmarked =
      bookmarkOverrideForResponse(response) ??
      (Boolean(node.isBookmarked) ||
      Boolean(response.bookmarked) ||
      responseIsBookmarkedBySet(response, node, bookmarkedResponseAddresses));
    const responsePairIds = responsePairIdsForGraphNode(response);
    const responseForkRecords = forkRecords.filter(
      (record) =>
        record.parentConversationId === node.loomId &&
        Boolean(node.responseId) &&
        (record.parentResponseId === node.responseId ||
          responsePairIds.has(record.parentResponseId))
    );
    const explorationForkRecords = responseForkRecords
      .filter((record) => record.kind !== "revision")
      .map(displayForkRecord);
    const revisionForkRecords = responseForkRecords.filter(
      (record) => record.kind === "revision"
    );
    const revisionVariants = graphRevisionVariantsForResponse(
      node,
      response,
      revisionForkRecords,
      responsesByConversation
    );
    const selectedRevisionIndex = Math.min(
      selectedGraphRevisionByResponseId[graphRevisionSelectionKey(node)] ?? 0,
      Math.max(0, revisionVariants.length - 1)
    );
    const activeRevisionVariant = revisionVariants[selectedRevisionIndex];
    const activeResponse = activeRevisionVariant?.response ?? response;
    const activeNode = activeRevisionVariant
      ? {
          ...node,
          loomId: activeRevisionVariant.loomId ?? node.loomId,
          title: activeRevisionVariant.title,
        }
      : node;
    const hasExistingWeft = explorationForkRecords.length > 0;
    const hasRevisionWeft = revisionForkRecords.length > 0;
    return {
      node: { ...activeNode, isBookmarked },
      response: activeResponse,
      hasExistingWeft,
      hasRevisionWeft,
      weftCount: explorationForkRecords.length,
      explorationForkRecords,
    };
  }, [
    bookmarkedResponseAddresses,
    bookmarkOverrideForResponse,
    displayForkRecord,
    forkRecords,
    projection.nodes,
    responsePreviewNodeId,
    responsesByConversation,
    selectedGraphRevisionByResponseId,
  ]);

  const responsePreviewPending = useMemo(() => {
    if (!responsePreviewNodeId) return false;
    const node = projection.nodes.find((item) => item.id === responsePreviewNodeId);
    if (!node) return false;
    const response = responseForGraphNode(node, responsesByConversation);
    return Boolean(response?.visibleProgress) && !responsePreview?.answerMarkdown.trim();
  }, [projection.nodes, responsePreview, responsePreviewNodeId, responsesByConversation]);

  const handleContinuationResponseCreated = useCallback(
    (response: ResponseItem) => {
      if (!continuationTarget) return;
      const nextNodeId = responseGraphNodeId(continuationTarget.loomId, response.id);
      setContinuationOpen(false);
      setContinuationNodeId(nextNodeId);
      setSelectedNodeId(nextNodeId);
      setPendingContinuationFocusNodeId(nextNodeId);
    },
    [continuationTarget]
  );

  const handleContinuationResponseCompleted = useCallback(
    (response: ResponseItem) => {
      if (!continuationTarget) return;
      const nextNodeId = responseGraphNodeId(continuationTarget.loomId, response.id);
      setContinuationNodeId(nextNodeId);
      setSelectedNodeId(nextNodeId);
      setPendingContinuationFocusNodeId(nextNodeId);
    },
    [continuationTarget]
  );

  const openContinuationForResponse = useCallback(
    (node: LoomGraphProjectionNode, response: ResponseItem) => {
      const target = {
        loomId: node.loomId,
        response,
        nodeId: node.id,
      };
      setContinuationTarget(target);
      setContinuationNodeId(node.id);
      setSelectedNodeId(node.id);
      setContinuationOpen(true);
      positionContinuationComposer(node.id);
      window.requestAnimationFrame(() => {
        focusNodeNearTop(node.id, 520);
        window.requestAnimationFrame(() => positionContinuationComposer(node.id));
      });
    },
    [focusNodeNearTop, positionContinuationComposer]
  );

  const flowNodes = useMemo<LoomGraphAnyNode[]>(
    () => {
      const nodes: LoomGraphAnyNode[] = projection.nodes.map((projectionNode) => {
        const response = responseForGraphNode(projectionNode, responsesByConversation);
        // Root (loom) nodes aren't tracked in bookmarkedResponseAddresses via the
        // response-specific helper, so derive their bookmark state from the loom path.
        const isBookmarked = projectionNode.kind === "root"
          ? (() => {
              const loom = conversations.find((c) => c.id === projectionNode.loomId);
              if (!loom) return false;
              return (
                bookmarkedResponseAddresses.has(loom.path) ||
                bookmarkedResponseAddresses.has(loom.id) ||
                Boolean(loom.meta?.canonicalUri && bookmarkedResponseAddresses.has(loom.meta.canonicalUri))
              );
            })()
          : bookmarkOverrideForResponse(response) ??
            (Boolean(projectionNode.isBookmarked) ||
            Boolean(response?.bookmarked) ||
            responseIsBookmarkedBySet(response, projectionNode, bookmarkedResponseAddresses));
        const responsePairIds = responsePairIdsForGraphNode(response);
        const responseForkRecords = forkRecords.filter(
          (record) =>
            record.parentConversationId === projectionNode.loomId &&
            Boolean(projectionNode.responseId) &&
            (record.parentResponseId === projectionNode.responseId ||
              responsePairIds.has(record.parentResponseId))
        );
        const explorationForkRecords = responseForkRecords
          .filter((record) => record.kind !== "revision")
          .map(displayForkRecord);
        const revisionForkRecords = responseForkRecords.filter(
          (record) => record.kind === "revision"
        );
        const hasExistingWeft =
          projectionNode.kind === "response" && explorationForkRecords.length > 0;
        const hasRevisionWeft = revisionForkRecords.length > 0;
        const weftCount = explorationForkRecords.length;
        const revisionVariants = graphRevisionVariantsForResponse(
          projectionNode,
          response,
          revisionForkRecords,
          responsesByConversation
        );
        const selectedRevisionIndex = Math.min(
          selectedGraphRevisionByResponseId[graphRevisionSelectionKey(projectionNode)] ?? 0,
          Math.max(0, revisionVariants.length - 1)
        );
        const activeRevisionVariant = revisionVariants[selectedRevisionIndex];
        const visibleProjectionNode = activeRevisionVariant
          ? {
              ...projectionNode,
              loomId: activeRevisionVariant.loomId ?? projectionNode.loomId,
              title: activeRevisionVariant.title,
            }
          : projectionNode;
        const visibleResponse = activeRevisionVariant?.response ?? response;
        const isResponsePending =
          Boolean(visibleResponse?.visibleProgress) &&
          !graphResponsePreviewForNode(
            visibleProjectionNode,
            visibleResponse
          )?.answerMarkdown.trim();
        return {
          id: projectionNode.id,
          type: "loomGraphNode",
          position: graphNodeRenderPosition(projectionNode),
          data: {
            projectionNode: {
              ...visibleProjectionNode,
              isBookmarked,
              isFocused: projectionNode.id === selectedNodeId || projectionNode.isFocused,
            },
            response: visibleResponse,
            onOpen: (node, nodeResponse) => {
              if (nodeResponse) {
                onOpenResponse(node.loomId, nodeResponse);
                return;
              }
              onOpenLoom(node.loomId);
            },
            onBookmark: (node, nodeResponse) => {
              if (nodeResponse) {
                onBookmarkResponse(node.loomId, nodeResponse, Boolean(node.isBookmarked));
              } else if (node.kind === "root") {
                onBookmarkLoom?.(node.loomId, Boolean(node.isBookmarked));
              }
            },
            onLink: (node, nodeResponse) => {
              if (nodeResponse) {
                openContinuationForResponse(node, nodeResponse);
                onLinkResponse(node.loomId, nodeResponse);
              } else if (node.kind === "root") {
                onLinkLoom?.(node.loomId);
              }
            },
            onWeft: (node, nodeResponse) => {
              if (nodeResponse) onWeftResponse(node.loomId, nodeResponse);
            },
            onOpenWeftRecord: (record) => {
              onOpenLoom(record.childConversationId);
            },
            onContinue: (node, nodeResponse) => {
              if (nodeResponse) openContinuationForResponse(node, nodeResponse);
            },
            hasExistingWeft,
            hasRevisionWeft,
            weftCount,
            weftRecords: explorationForkRecords,
            revisionVariantCount: revisionVariants.length,
            revisionVariantIndex: selectedRevisionIndex,
            onRevisionNavigate: (nextIndex) => {
              setSelectedGraphRevisionByResponseId((current) => ({
                ...current,
                [graphRevisionSelectionKey(projectionNode)]: nextIndex,
              }));
            },
            isTerminalResponse:
              projectionNode.kind === "response" && projectionNode.responseId
                ? latestActiveResponseNodeIds.has(projectionNode.responseId)
                : false,
            isResponsePending,
            continuationOpen:
              continuationOpen && continuationNodeId === projectionNode.id,
            viewportZoom: graphZoom,
          },
        };
      });
      if (continuationOpen && continuationTarget) {
        nodes.push({
          id: "loom-graph-continuation-composer",
          type: "loomGraphComposerNode",
          position: continuationComposerPosition,
          draggable: false,
          selectable: false,
          data: {
            onClose: () => {
              setContinuationOpen(false);
              setContinuationTarget(null);
            },
            content: renderContinuationComposer({
              loomId: continuationTarget.loomId,
              onSubmitStart: () => setContinuationOpen(false),
              onResponseCreated: handleContinuationResponseCreated,
              onResponseCompleted: handleContinuationResponseCompleted,
            }),
          },
        });
      }
      return nodes;
    },
    [
      onBookmarkResponse,
      onBookmarkLoom,
      onLinkResponse,
      onLinkLoom,
      onOpenLoom,
      onOpenResponse,
      onWeftResponse,
      bookmarkedResponseAddresses,
      bookmarkOverrideForResponse,
      conversations,
      displayForkRecord,
      forkRecords,
      projection.edges,
      projection.nodes,
      responsesByConversation,
      selectedGraphRevisionByResponseId,
      selectedNodeId,
      continuationComposerPosition,
      continuationOpen,
      continuationNodeId,
      continuationTarget,
      graphZoom,
      graphNodeRenderPosition,
      handleContinuationResponseCreated,
      openContinuationForResponse,
      latestActiveResponse,
      latestActiveResponseNodeIds,
      renderContinuationComposer,
      focusNodeNearTop,
      positionContinuationComposer,
    ]
  );

  const flowEdges = useMemo<LoomGraphFlowEdge[]>(
    () =>
      [
        ...projection.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "loomGraphEdge" as const,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
        },
        data: {
          kind: edge.kind,
          label: edge.label,
          references: edge.references,
          isActivePath: edge.isActivePath,
          isWeftPath: edge.isWeftPath,
        },
        })),
        ...(continuationOpen && continuationNodeId
          ? [{
              id: `${continuationNodeId}->loom-graph-continuation-composer`,
              source: continuationNodeId,
              target: "loom-graph-continuation-composer",
              type: "loomGraphEdge" as const,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 16,
                height: 16,
              },
              data: {
                kind: "continuation",
                isActivePath: true,
                isWeftPath: false,
              },
            }]
          : []),
      ],
    [continuationNodeId, continuationOpen, projection.edges]
  );

  const handleNodeClick = useCallback<NodeMouseHandler<LoomGraphAnyNode>>(
    (event, node) => {
      if (node.type === "loomGraphComposerNode") return;
      setSelectedNodeId(node.id);
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          "button, a, input, textarea, select, [role='button'], .loom-graph-node-actions"
        )
      ) {
        return;
      }
      const nodeResponse = responseForGraphNode(
        node.data.projectionNode,
        responsesByConversation
      );
      const preview = graphResponsePreviewForNode(node.data.projectionNode, nodeResponse);
      if (!preview) return;
      setResponsePreviewNodeId(node.id);
    },
    [responsesByConversation]
  );

  const handleNodeDoubleClick = useCallback<NodeMouseHandler<LoomGraphAnyNode>>(
    (_event, node) => {
      if (node.type === "loomGraphComposerNode") return;
      setExpandedNodeIds((current) => {
        const next = new Set(current);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      setSelectedNodeId(node.id);
      window.requestAnimationFrame(() => centerNode(node.id));
    },
    [centerNode]
  );

  const openContinuationComposer = useCallback(() => {
    if (!latestActiveResponse) return;
    openContinuationForResponse(
      {
        id: latestActiveResponse.nodeId,
        kind: "response",
        loomId: latestActiveResponse.loomId,
        responseId: latestActiveResponse.response.id,
        title: latestActiveResponse.response.title,
        depth: 0,
        position: { x: 0, y: 0 },
      },
      latestActiveResponse.response
    );
  }, [latestActiveResponse, openContinuationForResponse]);

  const selectedNode = projection.nodes.find((node) => node.id === selectedNodeId);

  return (
    <section className="graph-view" aria-label="Graph View">
      <div className="graph-header">
        <span>
          <GitBranch size={14} />
          Graph View
        </span>
        <h1>Weft-aware Loom graph</h1>
        <p>
          Active Loom responses, prompts, and Weft branches rendered as a top-down
          projection.
        </p>
        <label className="loom-graph-toggle">
          <input
            type="checkbox"
            checked={followLoomScroll}
            onChange={(event) => setFollowLoomScroll(event.target.checked)}
          />
          Follow Loom focus
        </label>
      </div>
      <div className="loom-graph-shell" ref={graphShellRef}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={{ x: 0, y: 0, zoom: GRAPH_DEFAULT_ZOOM }}
          minZoom={0.55}
          maxZoom={1.35}
          proOptions={{ hideAttribution: true }}
          panOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          connectOnClick={false}
          onMove={(_event, viewport) => setGraphZoom(viewport.zoom)}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={28}
            size={1}
            color="var(--loom-graph-grid)"
          />
          <GraphControls
            onFirst={() => centerNode(projection.firstNodeId)}
            onLast={() => centerNode(projection.lastNodeId)}
            onFit={() =>
              reactFlow.fitView({
                duration: 420,
                padding: 0.24,
                maxZoom: GRAPH_DEFAULT_ZOOM,
              })
            }
            onZoomIn={() => reactFlow.zoomIn({ duration: 180 })}
            onZoomOut={() => reactFlow.zoomOut({ duration: 180 })}
            onContinue={openContinuationComposer}
            continueDisabled={!latestActiveResponse}
          />
        </ReactFlow>
        <div className="loom-graph-status">
          <LocateFixed size={13} />
          {selectedNode ? selectedNode.title : "Select a graph node"}
        </div>
        <div className="loom-graph-legend" aria-label="Graph legend">
          <span>Response path</span>
          <span>
            <GitFork size={12} />
            Weft branch
          </span>
        </div>
        {projectionError && (
          <div className="loom-graph-empty-state" role="status">
            <strong>Graph projection unavailable</strong>
            <span>{projectionError}</span>
          </div>
        )}
        {responsePreview && (
          <div
            className="graph-response-preview-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setResponsePreviewNodeId(null);
            }}
          >
            <section
              className="graph-response-preview-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Response question and answer"
            >
              {responsePreviewTarget && (
                <div className="graph-response-preview-toolbar">
                  <div className="graph-response-preview-actions" aria-label="Response actions">
                    <div className="graph-response-preview-action-group">
                      <button
                        type="button"
                        className={
                          responsePreviewTarget.node.isBookmarked
                            ? "graph-response-preview-bookmark is-bookmarked"
                            : "graph-response-preview-bookmark"
                        }
                        title="Bookmark"
                        aria-pressed={responsePreviewTarget.node.isBookmarked}
                        aria-label={
                          responsePreviewTarget.node.isBookmarked
                            ? `Remove bookmark for ${responsePreviewTarget.node.title}`
                            : `Bookmark ${responsePreviewTarget.node.title}`
                        }
                        onClick={() =>
                          {
                            setBookmarkOverrideForResponse(
                              responsePreviewTarget.response,
                              !responsePreviewTarget.node.isBookmarked
                            );
                            onBookmarkResponse(
                              responsePreviewTarget.node.loomId,
                              responsePreviewTarget.response,
                              Boolean(responsePreviewTarget.node.isBookmarked)
                            );
                          }
                        }
                      >
                        <Bookmark
                          size={14}
                          fill={responsePreviewTarget.node.isBookmarked ? "currentColor" : "none"}
                        />
                      </button>
                      <button
                        type="button"
                        title="Link"
                        aria-label={`Link ${responsePreviewTarget.node.title}`}
                        onClick={() => {
                          openContinuationForResponse(
                            responsePreviewTarget.node,
                            responsePreviewTarget.response
                          );
                          onLinkResponse(
                            responsePreviewTarget.node.loomId,
                            responsePreviewTarget.response
                          );
                        }}
                      >
                        <Link2 size={14} />
                      </button>
                      <span className="graph-response-preview-weft-cluster">
                        <button
                          type="button"
                          className={
                            [
                              "graph-response-preview-weft",
                              responsePreviewTarget.hasExistingWeft ? "is-wefted" : "",
                              responsePreviewTarget.hasRevisionWeft ? "is-revision-wefted" : "",
                            ].filter(Boolean).join(" ")
                          }
                          title={
                            responsePreviewTarget.hasExistingWeft ? "Open Weft list" : "Start Weft"
                          }
                          aria-pressed={responsePreviewTarget.hasExistingWeft}
                          aria-haspopup={
                            responsePreviewTarget.weftCount > 0 ? "menu" : undefined
                          }
                          aria-expanded={
                            responsePreviewTarget.weftCount > 0
                              ? responsePreviewWeftPickerOpen
                              : undefined
                          }
                          aria-label={
                            responsePreviewTarget.hasExistingWeft
                              ? `Open Weft list from ${responsePreviewTarget.node.title}`
                              : `Start Weft from ${responsePreviewTarget.node.title}`
                          }
                          onClick={() => {
                            if (responsePreviewTarget.weftCount > 0) {
                              setResponsePreviewWeftPickerOpen((current) => !current);
                              return;
                            }
                            onWeftResponse(
                              responsePreviewTarget.node.loomId,
                              responsePreviewTarget.response
                            );
                          }}
                        >
                          <GitFork size={14} />
                          {responsePreviewTarget.weftCount > 0 && (
                            <span className="weft-count-badge">{responsePreviewTarget.weftCount}</span>
                          )}
                        </button>
                        {responsePreviewWeftPickerOpen && responsePreviewTarget.weftCount > 0 && (
                          <div
                            className="weft-branch-picker graph-response-preview-weft-picker nowheel nopan"
                            role="menu"
                            aria-label="Weft branches"
                            onWheelCapture={(event) => event.stopPropagation()}
                          >
                            {responsePreviewTarget.explorationForkRecords.map(
                              (record, branchIndex) => (
                                <button
                                  key={record.id}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setResponsePreviewWeftPickerOpen(false);
                                    setResponsePreviewNodeId(null);
                                    onOpenLoom(record.childConversationId);
                                  }}
                                >
                                  <GitFork size={13} />
                                  <span>
                                    <strong>{record.title}</strong>
                                    <em className="weft-branch-picker-meta">
                                      <span>{branchIndex + 1} of {responsePreviewTarget.weftCount}</span>
                                      <span>
                                        {formatRelativeTimestamp(record.createdAt) ||
                                          formatRelativeTimestamp(record.updatedAt) ||
                                          formatRelativeTimestamp(new Date().toISOString())}
                                      </span>
                                    </em>
                                  </span>
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </span>
                    </div>
                    <span className="graph-response-preview-action-separator" aria-hidden="true" />
                    <div className="graph-response-preview-action-group">
                      <button
                        type="button"
                        title="Open"
                        aria-label={`Open ${responsePreviewTarget.node.title}`}
                        onClick={() => {
                          onOpenResponse(
                            responsePreviewTarget.node.loomId,
                            responsePreviewTarget.response
                          );
                          setResponsePreviewNodeId(null);
                        }}
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                    <span className="graph-response-preview-action-separator" aria-hidden="true" />
                    <div className="graph-response-preview-action-group">
                      <button
                        type="button"
                        className="graph-response-preview-close"
                        title="Close"
                        aria-label="Close response preview"
                        onClick={() => setResponsePreviewNodeId(null)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <article className="graph-response-preview-scroll">
                <div className="graph-response-preview-block graph-response-preview-question">
                  <span>Question</span>
                  <GraphResponsePreviewQuestion question={responsePreview.question} />
                </div>
                <div className="graph-response-preview-block graph-response-preview-answer">
                  <span>Answer</span>
                  {responsePreviewPending ? (
                    <div className="graph-response-preview-waiting" role="status" aria-live="polite">
                      <Bot size={16} />
                      <p>Waiting for answer</p>
                    </div>
                  ) : (
                    <AssistantMarkdownContent markdown={responsePreview.answerMarkdown} />
                  )}
                </div>
              </article>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

export function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
