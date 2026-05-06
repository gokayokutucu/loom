import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeMouseHandler,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitBranch, GitFork, LocateFixed } from "lucide-react";
import {
  buildLoomGraphProjection,
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
  bookmarkedResponseAddresses: ReadonlySet<string>;
  onOpenLoom: (loomId: string) => void;
  onOpenResponse: (loomId: string, response: ResponseItem) => void;
  onBookmarkResponse: (loomId: string, response: ResponseItem) => void;
  onLinkResponse: (loomId: string, response: ResponseItem) => void;
  onWeftResponse: (loomId: string, response: ResponseItem) => void;
}

const nodeTypes: NodeTypes = {
  loomGraphNode: LoomGraphNode,
};

const edgeTypes: EdgeTypes = {
  loomGraphEdge: LoomGraphEdge,
};

const GRAPH_DEFAULT_ZOOM = 1.08;

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
  bookmarkedResponseAddresses,
  onOpenLoom,
  onOpenResponse,
  onBookmarkResponse,
  onLinkResponse,
  onWeftResponse,
}: GraphViewProps) {
  const reactFlow = useReactFlow<LoomGraphFlowNode, LoomGraphFlowEdge>();
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);
  const [followLoomScroll, setFollowLoomScroll] = useState(true);
  const initializedViewportKey = useRef<string | undefined>(undefined);

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
    if (!followLoomScroll) return;
    const focusedNodeId =
      activeLoomId && focusedResponseId
        ? responseGraphNodeId(activeLoomId, focusedResponseId)
        : projection.focusedNodeId;
    if (focusedNodeId) centerNode(focusedNodeId);
  }, [
    activeLoomId,
    centerNode,
    focusedResponseId,
    followLoomScroll,
    projection.focusedNodeId,
  ]);

  const flowNodes = useMemo<LoomGraphFlowNode[]>(
    () =>
      projection.nodes.map((projectionNode) => {
        const response = responseForNode(projectionNode, responsesByConversation);
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
          },
        };
      }),
    [
      onBookmarkResponse,
      onLinkResponse,
      onOpenLoom,
      onOpenResponse,
      onWeftResponse,
      projection.nodes,
      responsesByConversation,
      selectedNodeId,
    ]
  );

  const flowEdges = useMemo<LoomGraphFlowEdge[]>(
    () =>
      projection.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "loomGraphEdge",
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
    [projection.edges]
  );

  const handleNodeClick = useCallback<NodeMouseHandler<LoomGraphFlowNode>>(
    (_event, node) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  const handleNodeDoubleClick = useCallback<NodeMouseHandler<LoomGraphFlowNode>>(
    (_event, node) => {
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
      <div className="loom-graph-shell">
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
