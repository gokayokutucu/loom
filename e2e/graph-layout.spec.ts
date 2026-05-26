// E2E data authority classification: PURE_UI_HELPER.
// This spec validates graph node layout math only; it does not use product data.
import { expect, test } from "@playwright/test";
import {
  compactGraphNodePositions,
  GRAPH_NODE_VERTICAL_GAP,
} from "../src/features/graph/graphLayout";
import type { LoomGraphProjectionNode } from "../src/services/loomGraphProjection";

function graphNode(id: string, depth: number, x = 0): LoomGraphProjectionNode {
  return {
    id,
    kind: depth === 0 ? "root" : "response",
    loomId: "loom-1",
    title: id,
    depth,
    position: { x, y: depth * 560 },
  };
}

test.describe("[pure-ui-helper] graph layout", () => {
  test("uses measured node heights plus a compact fixed vertical gap", () => {
    const positions = compactGraphNodePositions(
      [graphNode("root", 0), graphNode("response-1", 1), graphNode("response-2", 2)],
      {
        root: 180,
        "response-1": 240,
        "response-2": 320,
      }
    );

    expect(positions.root.y).toBe(0);
    expect(positions["response-1"].y - positions.root.y - 180).toBe(
      GRAPH_NODE_VERTICAL_GAP
    );
    expect(positions["response-2"].y - positions["response-1"].y - 240).toBe(
      GRAPH_NODE_VERTICAL_GAP
    );
  });

  test("keeps same-depth branch nodes aligned while using the tallest row height", () => {
    const positions = compactGraphNodePositions(
      [
        graphNode("root", 0, 0),
        graphNode("response-1", 1, 0),
        graphNode("branch-root", 1, 460),
        graphNode("response-2", 2, 0),
      ],
      {
        root: 160,
        "response-1": 220,
        "branch-root": 360,
        "response-2": 200,
      }
    );

    expect(positions["response-1"].y).toBe(positions["branch-root"].y);
    expect(positions["response-2"].y - positions["response-1"].y - 360).toBe(
      GRAPH_NODE_VERTICAL_GAP
    );
  });
});
