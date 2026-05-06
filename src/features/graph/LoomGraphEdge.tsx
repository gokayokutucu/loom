import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export interface LoomGraphEdgeData extends Record<string, unknown> {
  kind: string;
  label?: string;
  isActivePath?: boolean;
  isWeftPath?: boolean;
}

export type LoomGraphFlowEdge = Edge<LoomGraphEdgeData, "loomGraphEdge">;

function getWeftBranchPath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const horizontalY = Math.min(sourceY + 26, targetY - 34);
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
      ? Math.min(Math.max(rawLabelY, sourceY + 44), targetY - 44)
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
            className="loom-graph-edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
