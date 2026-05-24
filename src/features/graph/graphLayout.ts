import type { LoomGraphProjectionNode } from "../../services/loomGraphProjection";

export const GRAPH_NODE_VERTICAL_GAP = 36;
export const GRAPH_FALLBACK_NODE_HEIGHT = 260;

export function compactGraphNodePositions(
  nodes: LoomGraphProjectionNode[],
  nodeHeights: Record<string, number>
) {
  const heightsByDepth = new Map<number, number>();
  nodes.forEach((node) => {
    const measuredHeight = nodeHeights[node.id] ?? GRAPH_FALLBACK_NODE_HEIGHT;
    heightsByDepth.set(
      node.depth,
      Math.max(heightsByDepth.get(node.depth) ?? 0, measuredHeight)
    );
  });

  const depths = Array.from(heightsByDepth.keys()).sort((left, right) => left - right);
  const yByDepth = new Map<number, number>();
  let cursor = 0;
  depths.forEach((depth, index) => {
    yByDepth.set(depth, cursor);
    cursor += (heightsByDepth.get(depth) ?? GRAPH_FALLBACK_NODE_HEIGHT) + GRAPH_NODE_VERTICAL_GAP;
    if (index === depths.length - 1) cursor += GRAPH_NODE_VERTICAL_GAP;
  });

  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: node.position.x,
        y: yByDepth.get(node.depth) ?? node.position.y,
      },
    ])
  );
}
