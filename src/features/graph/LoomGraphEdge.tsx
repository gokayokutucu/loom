import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { referenceLabelForMode } from "../../services/referenceDisplay";
import type { LoomLink } from "../../types";

export interface LoomGraphEdgeData extends Record<string, unknown> {
  kind: string;
  label?: string;
  references?: LoomLink[];
  isActivePath?: boolean;
  isWeftPath?: boolean;
}

export type LoomGraphFlowEdge = Edge<LoomGraphEdgeData, "loomGraphEdge">;

const EDGE_LABEL_NODE_CLEARANCE = 56;

function labelYBetweenNodes(sourceY: number, targetY: number, rawLabelY: number) {
  const verticalSpace = targetY - sourceY;
  if (verticalSpace <= EDGE_LABEL_NODE_CLEARANCE * 2) {
    return sourceY + verticalSpace / 2;
  }
  return Math.min(
    Math.max(rawLabelY, sourceY + EDGE_LABEL_NODE_CLEARANCE),
    targetY - EDGE_LABEL_NODE_CLEARANCE
  );
}

function getWeftBranchPath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const horizontalY = labelYBetweenNodes(
    sourceY,
    targetY,
    sourceY + EDGE_LABEL_NODE_CLEARANCE
  );
  const direction = targetX >= sourceX ? 1 : -1;
  const radius = Math.min(10, Math.abs(targetX - sourceX) / 3, Math.max(4, (targetY - sourceY) / 4));
  const path = [
    `M ${sourceX},${sourceY}`,
    `L ${sourceX},${horizontalY - radius}`,
    `Q ${sourceX},${horizontalY} ${sourceX + direction * radius},${horizontalY}`,
    `L ${targetX - direction * radius},${horizontalY}`,
    `Q ${targetX},${horizontalY} ${targetX},${horizontalY + radius}`,
    `L ${targetX},${targetY}`,
  ].join(" ");

  return [path, (sourceX + targetX) / 2, horizontalY] as const;
}

export function LoomGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<LoomGraphFlowEdge>) {
  const edgeData = data;
  const edgeKind = edgeData?.kind ?? "question";
  const [edgePath, labelX, rawLabelY] =
    edgeKind === "weft"
      ? getWeftBranchPath(sourceX, sourceY, targetX, targetY)
      : getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 20,
        });
  const labelY =
    targetY > sourceY
      ? labelYBetweenNodes(sourceY, targetY, rawLabelY)
      : rawLabelY;
  const className = [
    "loom-graph-edge",
    `loom-graph-edge--${edgeKind}`,
    edgeData?.isWeftPath ? "is-weft-path" : "",
    edgeData?.isActivePath ? "is-active-path" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} className={className} />
      {edgeData?.label && (
        <EdgeLabelRenderer>
          <div
            className={`loom-graph-edge-label loom-graph-edge-label--${edgeKind}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edgeData.references?.length ? (
              <span className="loom-graph-edge-reference-row">
                {edgeData.references.slice(0, 2).map((reference) => (
                  <span
                    className="loom-graph-edge-reference-token"
                    key={`${reference.id}-${reference.path}`}
                    title={reference.selectedText ?? reference.title}
                  >
                    {referenceLabelForMode(reference, reference.referenceDisplayMode ?? "title")}
                  </span>
                ))}
              </span>
            ) : null}
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
