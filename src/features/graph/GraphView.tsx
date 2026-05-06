import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { GitBranch, GitFork, LocateFixed, X } from "lucide-react";
import {
  buildLoomGraphProjection,
  loomGraphRootNodeId,
  responseGraphNodeId,
  type LoomGraphProjectionNode,
  type LoomGraphProjection,
} from "../../services/loomGraphProjection";
import type { Conversation, LoomForkRecord, ResponseItem } from "../../types";
import { GraphControls } from "./GraphControls";
import { LoomGraphEdge, type LoomGraphFlowEdge } from "./LoomGraphEdge";
import { LoomGraphNode, type LoomGraphFlowNode } from "./LoomGraphNode";

export interface GraphViewProps {
  conversations: Conversation[];
  responsesByConversation: Record<string, ResponseItem[]>;
  forkRecords: LoomForkRecord[];
  activeLoomId?: string;
  focusedResponseId?: string;
  focusedWeftLoomId?: string | null;
  bookmarkedResponseAddresses: ReadonlySet<string>;
  onOpenLoom: (loomId: string) => void;
  onOpenResponse: (loomId: string, response: ResponseItem) => void;
  onBookmarkResponse: (loomId: string, response: ResponseItem) => void;
  onLinkResponse: (loomId: string, response: ResponseItem) => void;
  onWeftResponse: (loomId: string, response: ResponseItem) => void;
  onAskResponse: (loomId: string, response: ResponseItem) => void;
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
const GRAPH_FALLBACK_NODE_HEIGHT = 220;

interface LoomGraphComposerNodeData extends Record<string, unknown> {
  content: ReactNode;
  onClose: () => void;
}

type LoomGraphComposerFlowNode = Node<
  LoomGraphComposerNodeData,
  "loomGraphComposerNode"
>;

type LoomGraphAnyNode = LoomGraphFlowNode | LoomGraphComposerFlowNode;

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
      className="loom-graph-composer-node nodrag nowheel"
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

const nodeTypes: NodeTypes = {
  loomGraphNode: LoomGraphNode,
  loomGraphComposerNode: LoomGraphComposerNode,
};

function responseForNode(
  node: LoomGraphProjectionNode,
  responsesByConversation: Record<string, ResponseItem[]>
) {
  if (!node.responseId) return undefined;
  return (responsesByConversation[node.loomId] ?? []).find(
    (response) => response.id === node.responseId
  );
}

function selectedNodeIdForProjection(projection: LoomGraphProjection) {
  return projection.focusedNodeId ?? projection.lastNodeId ?? projection.firstNodeId;
}

function GraphViewInner({
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
  onLinkResponse,
  onWeftResponse,
  onAskResponse,
  renderContinuationComposer,
}: GraphViewProps) {
  const reactFlow = useReactFlow<LoomGraphAnyNode, LoomGraphFlowEdge>();
  const graphShellRef = useRef<HTMLDivElement | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [followLoomScroll, setFollowLoomScroll] = useState(true);
  const [continuationNodeId, setContinuationNodeId] = useState<string | undefined>(undefined);
  const [continuationOpen, setContinuationOpen] = useState(false);
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
  const initializedViewportKey = useRef<string | undefined>(undefined);
  const skipNextFollowAfterWeftFocusRef = useRef(false);

  const projection = useMemo(
    () =>
      buildLoomGraphProjection({
        conversations,
        responsesByConversation,
        forkRecords,
        activeLoomId,
        focusedResponseId,
        expandedNodeIds,
        bookmarkedResponseAddresses,
      }),
    [
      conversations,
      responsesByConversation,
      forkRecords,
      activeLoomId,
      focusedResponseId,
      expandedNodeIds,
      bookmarkedResponseAddresses,
    ]
  );

  const centerNode = useCallback(
    (nodeId: string | undefined) => {
      if (!nodeId) return;
      const node = projection.nodes.find((item) => item.id === nodeId);
      if (!node) return;
      reactFlow.setCenter(node.position.x + 150, node.position.y + 80, {
        zoom: GRAPH_DEFAULT_ZOOM,
        duration: 420,
      });
      setSelectedNodeId(nodeId);
    },
    [projection.nodes, reactFlow]
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
      reactFlow.setViewport(
        {
          x: width / 2 - (node.position.x + GRAPH_NODE_WIDTH / 2) * GRAPH_DEFAULT_ZOOM,
          y: GRAPH_FOCUS_TOP_OFFSET - node.position.y * GRAPH_DEFAULT_ZOOM,
          zoom: GRAPH_DEFAULT_ZOOM,
        },
        { duration }
      );
      setSelectedNodeId(nodeId);
    },
    [centerNode, projection.nodes, reactFlow]
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
    setContinuationComposerPosition({
      x: projectionNode.position.x + (GRAPH_NODE_WIDTH - GRAPH_COMPOSER_WIDTH) / 2,
      y: projectionNode.position.y + measuredHeight + GRAPH_COMPOSER_NODE_GAP / zoom,
    });
  }, [projection.nodes, reactFlow]);

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

  useEffect(() => {
    const nextNodeId = selectedNodeIdForProjection(projection);
    setSelectedNodeId((current) => current ?? nextNodeId);
  }, [projection]);

  useEffect(() => {
    const viewportKey = activeLoomId ?? projection.firstNodeId;
    if (!viewportKey || initializedViewportKey.current === viewportKey) return;
    initializedViewportKey.current = viewportKey;
    window.requestAnimationFrame(() => centerNode(selectedNodeIdForProjection(projection)));
  }, [activeLoomId, centerNode, projection]);

  useEffect(() => {
    if (focusedWeftLoomId) return;
    if (skipNextFollowAfterWeftFocusRef.current) {
      skipNextFollowAfterWeftFocusRef.current = false;
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
    window.requestAnimationFrame(() => {
      focusNodeNearTop(pendingContinuationFocusNodeId, 520);
      setPendingContinuationFocusNodeId(undefined);
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
    setPendingContinuationFocusNodeId(undefined);
    setPendingWeftFocusNodeId(undefined);
  }, [activeLoomId]);

  const handleContinuationResponseCreated = useCallback(
    (response: ResponseItem) => {
      if (!latestActiveResponse) return;
      const nextNodeId = responseGraphNodeId(latestActiveResponse.loomId, response.id);
      setContinuationOpen(false);
      setContinuationNodeId(nextNodeId);
    },
    [latestActiveResponse]
  );

  const handleContinuationResponseCompleted = useCallback(
    (response: ResponseItem) => {
      if (!latestActiveResponse) return;
      const nextNodeId = responseGraphNodeId(latestActiveResponse.loomId, response.id);
      setContinuationNodeId(nextNodeId);
      setSelectedNodeId(nextNodeId);
      setPendingContinuationFocusNodeId(nextNodeId);
    },
    [latestActiveResponse]
  );

  const flowNodes = useMemo<LoomGraphAnyNode[]>(
    () => {
      const nodes: LoomGraphAnyNode[] = projection.nodes.map((projectionNode) => {
        const response = responseForNode(projectionNode, responsesByConversation);
        const hasExistingWeft =
          projectionNode.kind === "response" &&
          forkRecords.some(
            (record) =>
              record.parentConversationId === projectionNode.loomId &&
              record.parentResponseId === projectionNode.responseId
          );
        return {
          id: projectionNode.id,
          type: "loomGraphNode",
          position: projectionNode.position,
          data: {
            projectionNode: {
              ...projectionNode,
              isFocused: projectionNode.id === selectedNodeId || projectionNode.isFocused,
            },
            response,
            onOpen: (node, nodeResponse) => {
              if (nodeResponse) {
                onOpenResponse(node.loomId, nodeResponse);
                return;
              }
              onOpenLoom(node.loomId);
            },
            onBookmark: (node, nodeResponse) => {
              if (nodeResponse) onBookmarkResponse(node.loomId, nodeResponse);
            },
            onLink: (node, nodeResponse) => {
              if (nodeResponse) onLinkResponse(node.loomId, nodeResponse);
            },
            onWeft: (node, nodeResponse) => {
              if (nodeResponse) onWeftResponse(node.loomId, nodeResponse);
            },
            onAsk: (node, nodeResponse) => {
              if (nodeResponse) onAskResponse(node.loomId, nodeResponse);
            },
            onContinue: (node) => {
              setContinuationNodeId(node.id);
              setSelectedNodeId(node.id);
              setContinuationOpen(true);
              positionContinuationComposer(node.id);
              window.requestAnimationFrame(() => {
                focusNodeNearTop(node.id, 520);
                window.requestAnimationFrame(() => positionContinuationComposer(node.id));
              });
            },
            hasExistingWeft,
            isTerminalResponse: projectionNode.id === latestActiveResponse?.nodeId,
            continuationOpen:
              continuationOpen && continuationNodeId === projectionNode.id,
            viewportZoom: graphZoom,
          },
        };
      });
      if (continuationOpen && latestActiveResponse) {
        nodes.push({
          id: "loom-graph-continuation-composer",
          type: "loomGraphComposerNode",
          position: continuationComposerPosition,
          draggable: false,
          selectable: false,
          data: {
            onClose: () => setContinuationOpen(false),
            content: renderContinuationComposer({
              loomId: latestActiveResponse.loomId,
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
      onLinkResponse,
      onOpenLoom,
      onOpenResponse,
      onWeftResponse,
      onAskResponse,
      forkRecords,
      projection.nodes,
      responsesByConversation,
      selectedNodeId,
      continuationComposerPosition,
      continuationOpen,
      continuationNodeId,
      graphZoom,
      handleContinuationResponseCreated,
      latestActiveResponse,
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
    (_event, node) => {
      if (node.type === "loomGraphComposerNode") return;
      setSelectedNodeId(node.id);
    },
    []
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
    setContinuationNodeId(latestActiveResponse.nodeId);
    setSelectedNodeId(latestActiveResponse.nodeId);
    setContinuationOpen(true);
    positionContinuationComposer(latestActiveResponse.nodeId);
    window.requestAnimationFrame(() => {
      focusNodeNearTop(latestActiveResponse.nodeId, 520);
      window.requestAnimationFrame(() =>
        positionContinuationComposer(latestActiveResponse.nodeId)
      );
    });
  }, [focusNodeNearTop, latestActiveResponse, positionContinuationComposer]);

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
            color="rgba(229, 225, 190, 0.12)"
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
