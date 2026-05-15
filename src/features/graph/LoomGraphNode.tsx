import {
  Bookmark,
  ExternalLink,
  GitFork,
  Link2,
  MessageSquare,
  Plus,
  Workflow,
} from "lucide-react";
import type { CSSProperties } from "react";
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
  onContinue: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  hasExistingWeft?: boolean;
  isTerminalResponse?: boolean;
  continuationOpen?: boolean;
  viewportZoom?: number;
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

function normalizePreviewText(value?: string) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function LoomGraphNode({ data }: NodeProps<LoomGraphFlowNode>) {
  const {
    projectionNode,
    response,
    onOpen,
    onBookmark,
    onLink,
    onWeft,
    onContinue,
    hasExistingWeft,
    isTerminalResponse,
    continuationOpen,
    viewportZoom = 1,
  } = data;
  const canActOnResponse = projectionNode.kind === "response" && Boolean(response);
  const canOpenNode = projectionNode.kind === "response" ? Boolean(response) : true;
  const showContinuationButton =
    canActOnResponse && isTerminalResponse && !continuationOpen;
  const summaryText = normalizePreviewText(projectionNode.summary);
  const previewText = normalizePreviewText(projectionNode.contentPreview);
  const showSummary = Boolean(summaryText) && projectionNode.kind !== "response";
  const showPreview = Boolean(previewText) && previewText !== summaryText;

  return (
    <article className={nodeClassName(projectionNode)}>
      <Handle
        type="target"
        position={Position.Top}
        className={
          projectionNode.kind === "root"
            ? "loom-graph-handle loom-graph-handle--hidden"
            : "loom-graph-handle"
        }
        isConnectable={false}
      />
      <div className="loom-graph-node-header">
        <span className="loom-graph-node-kind">
          {projectionNode.kind === "weft" ? <Workflow size={13} /> : <MessageSquare size={13} />}
          {nodeKindLabel(projectionNode)}
        </span>
        {canOpenNode && (
          <button
            type="button"
            className="loom-graph-node-open"
            title="Open"
            aria-label={`Open ${projectionNode.title}`}
            onClick={() => onOpen(projectionNode, response)}
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>
      <h3>{projectionNode.title}</h3>
      {showSummary && (
        <p className="loom-graph-summary">{projectionNode.summary}</p>
      )}
      {showPreview && (
        <p className="loom-graph-preview">{projectionNode.contentPreview}</p>
      )}
      <div className="loom-graph-node-flags" aria-label="Node metadata">
        {projectionNode.isAddressable && <span>addressable</span>}
        {projectionNode.code && (
          <span className="loom-graph-code">{projectionNode.code}</span>
        )}
      </div>
      {canActOnResponse && (
        <div className="loom-graph-node-actions">
          <button
            type="button"
            className={
              projectionNode.isBookmarked
                ? "loom-graph-node-bookmark is-bookmarked"
                : "loom-graph-node-bookmark"
            }
            aria-pressed={projectionNode.isBookmarked}
            aria-label={
              projectionNode.isBookmarked
                ? `Remove bookmark for ${projectionNode.title}`
                : `Bookmark ${projectionNode.title}`
            }
            onClick={() => onBookmark(projectionNode, response)}
          >
            <Bookmark size={13} fill={projectionNode.isBookmarked ? "currentColor" : "none"} />
            <span>Bookmark</span>
          </button>
          <button type="button" onClick={() => onLink(projectionNode, response)}>
            <Link2 size={13} />
            <span>Link</span>
          </button>
          <button
            type="button"
            className={hasExistingWeft ? "loom-graph-node-weft is-wefted" : "loom-graph-node-weft"}
            aria-pressed={hasExistingWeft}
            aria-label={
              hasExistingWeft
                ? `Open Weft from ${projectionNode.title}`
                : `Start Weft from ${projectionNode.title}`
            }
            onClick={() => onWeft(projectionNode, response)}
          >
            <GitFork size={13} />
            <span>Weft</span>
          </button>
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="loom-graph-handle"
        isConnectable={false}
      />
      {showContinuationButton && (
        <button
          type="button"
          className="loom-graph-terminal-continue nodrag"
          aria-label={`Continue from ${projectionNode.title}`}
          title="Continue from this response"
          style={
            {
              "--loom-graph-control-scale": String(1 / viewportZoom),
            } as CSSProperties
          }
          onClick={(event) => {
            event.stopPropagation();
            onContinue(projectionNode, response);
          }}
        >
          <Plus size={18} />
        </button>
      )}
    </article>
  );
}
