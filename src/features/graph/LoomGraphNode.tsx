import {
  Bookmark,
  Bot,
  ExternalLink,
  GitFork,
  Link2,
  MessageSquare,
  Plus,
  Workflow,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { formatBadgeCode } from "../../services/displayCode";
import { cleanMarkdownDisplayText } from "../../services/assistantMarkdown";
import { polishDisplayTitle } from "../../services/displayTitlePolish";
import { formatRelativeTimestamp } from "../../services/timeLabels";
import {
  isLoomGraphDestinationNode,
  type LoomGraphProjectionNode,
} from "../../services/loomGraphProjection";
import type { LoomForkRecord, ResponseItem } from "../../types";
import { graphNodePreviewText } from "./graphNodePreview";

export interface LoomGraphNodeData extends Record<string, unknown> {
  projectionNode: LoomGraphProjectionNode;
  response?: ResponseItem;
  onOpen: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  onBookmark: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  onLink: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  onWeft: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  onOpenWeftRecord?: (record: LoomForkRecord) => void;
  onContinue: (node: LoomGraphProjectionNode, response?: ResponseItem) => void;
  hasExistingWeft?: boolean;
  hasRevisionWeft?: boolean;
  weftCount?: number;
  weftRecords?: LoomForkRecord[];
  revisionVariantCount?: number;
  revisionVariantIndex?: number;
  onRevisionNavigate?: (nextIndex: number) => void;
  isTerminalResponse?: boolean;
  isResponsePending?: boolean;
  continuationOpen?: boolean;
  viewportZoom?: number;
}

export type LoomGraphFlowNode = Node<LoomGraphNodeData, "loomGraphNode">;

// Visual rendering intentionally checks `node.kind` directly in this file.
// "root" and "weft" are both Loom destination nodes — the distinction is topology/lineage,
// not ontology. For semantic (non-visual) checks use isLoomGraphDestinationNode,
// isWeftGraphNode, or graphNodeLineageRole from loomGraphProjection.

function nodeClassName(node: LoomGraphProjectionNode) {
  return [
    "loom-graph-node",
    `loom-graph-node--${node.kind}`,  // CSS variant intentionally encodes kind
    node.isFocused ? "is-focused" : "",
    node.isExpanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function nodeKindLabel(node: LoomGraphProjectionNode) {
  // Display labels intentionally distinguish "root" (active Loom) from "weft" (branched Loom).
  if (node.kind === "root") return "Loom";
  if (node.kind === "weft") return "Weft";
  if (node.kind === "response") return "Response";
  if (node.kind === "bookmark") return "Bookmark";
  return "Reference";
}

function normalizePreviewText(value?: string) {
  return cleanMarkdownDisplayText(value);
}

export function LoomGraphNode({ data }: NodeProps<LoomGraphFlowNode>) {
  const {
    projectionNode,
    response,
    onOpen,
    onBookmark,
    onLink,
    onWeft,
    onOpenWeftRecord,
    onContinue,
    hasExistingWeft,
    hasRevisionWeft,
    weftCount = 0,
    weftRecords = [],
    revisionVariantCount = 0,
    revisionVariantIndex = 0,
    onRevisionNavigate,
    isTerminalResponse,
    isResponsePending,
    continuationOpen,
    viewportZoom = 1,
  } = data;
  const [weftPickerOpen, setWeftPickerOpen] = useState(false);
  const weftClusterRef = useRef<HTMLSpanElement | null>(null);
  const canActOnResponse = projectionNode.kind === "response" && Boolean(response);
  const canActOnLoom = isLoomGraphDestinationNode(projectionNode);
  const canOpenNode = projectionNode.kind === "response" ? Boolean(response) : true;
  const showContinuationButton =
    canActOnResponse && isTerminalResponse && !continuationOpen;
  const summaryText = normalizePreviewText(projectionNode.summary);
  const previewText = graphNodePreviewText(projectionNode, response);
  const showSummary = Boolean(summaryText) && projectionNode.kind !== "response";
  const showPreview = Boolean(previewText);
  const showPending = projectionNode.kind === "response" && isResponsePending && !showPreview;
  const nodeTitle =
    polishDisplayTitle(cleanMarkdownDisplayText(projectionNode.title)) ||
    projectionNode.title;
  const hasRevisionCarousel =
    projectionNode.kind === "response" &&
    revisionVariantCount > 1 &&
    Boolean(onRevisionNavigate);
  const previousRevisionIndex =
    hasRevisionCarousel && revisionVariantIndex > 0 ? revisionVariantIndex - 1 : undefined;
  const nextRevisionIndex =
    hasRevisionCarousel && revisionVariantIndex < revisionVariantCount - 1
      ? revisionVariantIndex + 1
      : undefined;
  const canOpenWeftPicker = weftRecords.length > 0 && Boolean(onOpenWeftRecord);

  useEffect(() => {
    if (!weftPickerOpen) return undefined;
    const closeWeftPicker = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof globalThis.Node && weftClusterRef.current?.contains(target)) return;
      setWeftPickerOpen(false);
    };
    window.addEventListener("pointerdown", closeWeftPicker);
    return () => window.removeEventListener("pointerdown", closeWeftPicker);
  }, [weftPickerOpen]);

  return (
    <article className={nodeClassName(projectionNode)}>
      {/* Root has no inbound edge, so the target handle is hidden for visual cleanliness. */}
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
          {/* Icon deliberately differs between root ("Loom") and weft ("Weft") for visual distinction. */}
          {projectionNode.kind === "weft" ? <Workflow size={13} /> : <MessageSquare size={13} />}
          {nodeKindLabel(projectionNode)}
        </span>
        {canOpenNode && (
          <button
            type="button"
            className="loom-graph-node-open"
            title="Open"
            aria-label={`Open ${nodeTitle}`}
            onClick={() => onOpen(projectionNode, response)}
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>
      <div className="loom-graph-node-title-row">
        {hasRevisionCarousel && (
          <button
            type="button"
            className="loom-graph-node-revision-nav"
            aria-label="Previous graph message revision"
            title="Previous message revision"
            disabled={previousRevisionIndex === undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (previousRevisionIndex !== undefined) onRevisionNavigate?.(previousRevisionIndex);
            }}
          >
            {"<"}
          </button>
        )}
        <h3
          className={
            projectionNode.kind === "response" ? "loom-graph-node-question-preview" : undefined
          }
          title={projectionNode.kind === "response" ? nodeTitle : undefined}
        >
          {nodeTitle}
        </h3>
        {hasRevisionCarousel && (
          <button
            type="button"
            className="loom-graph-node-revision-nav"
            aria-label="Next graph message revision"
            title="Next message revision"
            disabled={nextRevisionIndex === undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (nextRevisionIndex !== undefined) onRevisionNavigate?.(nextRevisionIndex);
            }}
          >
            {">"}
          </button>
        )}
      </div>
      {showSummary && (
        <p className="loom-graph-summary">{summaryText}</p>
      )}
      {showPreview && (
        <p className="loom-graph-preview">{previewText}</p>
      )}
      {showPending && (
        <div className="loom-graph-preview-waiting" role="status" aria-live="polite">
          <Bot size={15} />
          <span>Waiting for answer</span>
        </div>
      )}
      <div className="loom-graph-node-flags" aria-label="Node metadata">
        {projectionNode.isAddressable && <span>addressable</span>}
        {(projectionNode.code || projectionNode.displayCode) && (
          <span
            className="loom-graph-code"
            title={`Full code: ${projectionNode.code ?? projectionNode.displayCode}`}
            aria-label={`Full code: ${projectionNode.code ?? projectionNode.displayCode}`}
          >
            {formatBadgeCode({
              code: projectionNode.code,
              displayCode: projectionNode.displayCode,
            })}
          </span>
        )}
      </div>
      {(canActOnResponse || canActOnLoom) && (
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
                : `Bookmark ${nodeTitle}`
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
          {canActOnResponse && (
            <span className="loom-graph-node-weft-cluster nodrag" ref={weftClusterRef}>
              <button
                type="button"
                className={[
                  "loom-graph-node-weft",
                  hasExistingWeft ? "is-wefted" : "",
                  hasRevisionWeft ? "is-revision-wefted" : "",
                ].filter(Boolean).join(" ")}
                aria-pressed={hasExistingWeft}
                aria-haspopup={canOpenWeftPicker ? "menu" : undefined}
                aria-expanded={canOpenWeftPicker ? weftPickerOpen : undefined}
                aria-label={
                  hasExistingWeft
                    ? `Open Weft list from ${projectionNode.title}`
                    : `Start Weft from ${projectionNode.title}`
                }
                onClick={(event) => {
                  event.stopPropagation();
                  if (canOpenWeftPicker) {
                    setWeftPickerOpen((current) => !current);
                    return;
                  }
                  onWeft(projectionNode, response);
                }}
              >
                <GitFork size={13} />
                <span>Weft</span>
                {weftCount > 0 && <span className="weft-count-badge">{weftCount}</span>}
              </button>
              {weftPickerOpen && canOpenWeftPicker && (
                <div
                  className="weft-branch-picker loom-graph-node-weft-picker nowheel nopan"
                  role="menu"
                  aria-label="Weft branches"
                  onWheelCapture={(event) => event.stopPropagation()}
                >
                  {weftRecords.map((record, branchIndex) => (
                    <button
                      key={record.id}
                      type="button"
                      role="menuitem"
                      onClick={(event) => {
                        event.stopPropagation();
                        setWeftPickerOpen(false);
                        onOpenWeftRecord?.(record);
                      }}
                    >
                      <GitFork size={13} />
                      <span>
                        <strong>{record.title}</strong>
                        <em className="weft-branch-picker-meta">
                          <span>{branchIndex + 1} of {weftRecords.length}</span>
                          <span>
                            {formatRelativeTimestamp(record.createdAt) ||
                              formatRelativeTimestamp(record.updatedAt) ||
                              formatRelativeTimestamp(new Date().toISOString())}
                          </span>
                        </em>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
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
