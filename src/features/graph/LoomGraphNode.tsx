import {
  Bookmark,
  ExternalLink,
  GitFork,
  Link2,
  MessageSquare,
  Workflow,
} from "lucide-react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { LoomGraphProjectionNode } from "../../services/loomGraphProjection";
import type { ResponseItem } from "../../types";

export interface LoomGraphNodeData extends Record<string, unknown> {
  projectionNode: LoomGraphProjectionNode;
  response?: ResponseItem;
  onOpen: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  onBookmark: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  onLink: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  onWeft: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
}

export type LoomGraphFlowNode = Node<LoomGraphNodeData, "loomGraphNode">;

function nodeClassName(node: LoomGraphProjectionNode) {
  return [
    "loom-graph-node",
    `loom-graph-node--${node.kind}`,
    node.isFocused ? "is-focused" : "",
    node.isExpanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function nodeKindLabel(node: LoomGraphProjectionNode) {
  if (node.kind === "root") return "Loom";
  if (node.kind === "weft") return "Weft";
  if (node.kind === "response") return "Response";
  if (node.kind === "bookmark") return "Bookmark";
  return "Reference";
}

export function LoomGraphNode({ data }: NodeProps<LoomGraphFlowNode>) {
  const { projectionNode, response, onOpen, onBookmark, onLink, onWeft } = data;
  const canActOnResponse = projectionNode.kind === "response" && Boolean(response);

  return (
    <article className={nodeClassName(projectionNode)}>
      <Handle type="target" position={Position.Top} className="loom-graph-handle" />
      <div className="loom-graph-node-header">
        <span className="loom-graph-node-kind">
          {projectionNode.kind === "weft" ? <Workflow size={13} /> : <MessageSquare size={13} />}
          {nodeKindLabel(projectionNode)}
        </span>
        {projectionNode.code && (
          <span className="loom-graph-code">{projectionNode.code}</span>
        )}
      </div>
      <h3>{projectionNode.title}</h3>
      {projectionNode.summary && projectionNode.kind !== "response" && (
        <p className="loom-graph-summary">{projectionNode.summary}</p>
      )}
      {projectionNode.contentPreview && (
        <p className="loom-graph-preview">{projectionNode.contentPreview}</p>
      )}
      <div className="loom-graph-node-flags" aria-label="Node metadata">
        {projectionNode.isAddressable && <span>addressable</span>}
        {projectionNode.isBookmarked && (
          <span>
            <Bookmark size={11} />
            bookmarked
          </span>
        )}
      </div>
      {canActOnResponse && (
        <div className="loom-graph-node-actions">
          <button type="button" onClick={() => onOpen(projectionNode, response)}>
            <ExternalLink size={13} />
            <span>Open</span>
          </button>
          <button type="button" onClick={() => onBookmark(projectionNode, response)}>
            <Bookmark size={13} />
            <span>Bookmark</span>
          </button>
          <button type="button" onClick={() => onLink(projectionNode, response)}>
            <Link2 size={13} />
            <span>Link</span>
          </button>
          <button type="button" onClick={() => onWeft(projectionNode, response)}>
            <GitFork size={13} />
            <span>Weft</span>
          </button>
        </div>
      )}
      {projectionNode.kind === "response" && projectionNode.isFocused && (
        <div className="loom-graph-node-composer" aria-label="Focused node composer">
          <span>Ask from this node...</span>
          <button type="button" disabled>
            Soon
          </button>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="loom-graph-handle" />
    </article>
  );
}
