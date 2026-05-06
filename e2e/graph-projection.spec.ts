import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  buildLoomGraphProjection,
  loomGraphRootNodeId,
  responseGraphNodeId,
} from "../src/services/loomGraphProjection";
import type { Conversation, LoomForkRecord, ResponseItem } from "../src/types";

function loom(id: string, title: string): Conversation {
  return {
    id,
    title,
    path: `loom://test/${id}`,
    folder: "Test",
    summary: `${title} summary`,
  };
}

function response(id: string, question: string): ResponseItem {
  return {
    id,
    title: question,
    address: `loom://test/${id}`,
    question,
    answer: [`Answer for ${question}`],
    suggestedLinks: [],
    bookmarkedLinks: [],
  };
}

test.describe("Loom graph projection hierarchy", () => {
  test("keeps root top-most and same-lineage responses ordered downward", () => {
    const projection = buildLoomGraphProjection({
      conversations: [loom("root", "Root Loom")],
      responsesByConversation: {
        root: [
          response("r1", "First question"),
          response("r2", "Second question"),
          response("r3", "Third question"),
        ],
      },
      forkRecords: [],
      activeLoomId: "root",
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const root = projection.nodes.find((node) => node.id === loomGraphRootNodeId("root"));
    const first = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r1"));
    const second = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r2"));
    const third = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r3"));

    expect(root?.position.y).toBe(0);
    expect(first?.position.y).toBeGreaterThan(root?.position.y ?? -1);
    expect(second?.position.y).toBeGreaterThan(first?.position.y ?? -1);
    expect(third?.position.y).toBeGreaterThan(second?.position.y ?? -1);
  });

  test("anchors Weft branches at the origin response and continues downward", () => {
    const forkRecords: LoomForkRecord[] = [
      {
        id: "fork-root-child",
        parentConversationId: "root",
        parentResponseId: "r1",
        childConversationId: "child",
        title: "Child Weft",
      },
    ];
    const projection = buildLoomGraphProjection({
      conversations: [loom("root", "Root Loom"), loom("child", "Child Weft")],
      responsesByConversation: {
        root: [response("r1", "Origin question"), response("r2", "Continuation")],
        child: [response("c1", "Branch question")],
      },
      forkRecords,
      activeLoomId: "root",
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const origin = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r1"));
    const childRoot = projection.nodes.find((node) => node.id === loomGraphRootNodeId("child"));
    const childResponse = projection.nodes.find((node) =>
      node.id === responseGraphNodeId("child", "c1")
    );
    const branchEdge = projection.edges.find(
      (edge) =>
        edge.source === responseGraphNodeId("root", "r1") &&
        edge.target === loomGraphRootNodeId("child")
    );

    expect(branchEdge?.kind).toBe("weft");
    expect(childRoot?.position.y).toBeGreaterThan(origin?.position.y ?? -1);
    expect(childRoot?.position.x).not.toBe(origin?.position.x);
    expect(childResponse?.position.y).toBeGreaterThan(childRoot?.position.y ?? -1);
    projection.edges.forEach((edge) => {
      const source = projection.nodes.find((node) => node.id === edge.source);
      const target = projection.nodes.find((node) => node.id === edge.target);
      expect(target?.position.y).toBeGreaterThan(source?.position.y ?? -1);
    });
  });

  test("places Weft branches as a balanced downward tree around their origin", () => {
    const forkRecords: LoomForkRecord[] = [
      {
        id: "fork-root-left",
        parentConversationId: "root",
        parentResponseId: "r1",
        childConversationId: "left",
        title: "Left Weft",
      },
      {
        id: "fork-root-right",
        parentConversationId: "root",
        parentResponseId: "r2",
        childConversationId: "right",
        title: "Right Weft",
      },
      {
        id: "fork-left-child",
        parentConversationId: "left",
        parentResponseId: "l1",
        childConversationId: "left-child",
        title: "Nested Weft",
      },
    ];
    const projection = buildLoomGraphProjection({
      conversations: [
        loom("root", "Root Loom"),
        loom("left", "Left Weft"),
        loom("right", "Right Weft"),
        loom("left-child", "Nested Weft"),
      ],
      responsesByConversation: {
        root: [
          response("r1", "First origin"),
          response("r2", "Second origin"),
          response("r3", "Trunk continuation"),
        ],
        left: [response("l1", "Left branch response")],
        right: [response("rr1", "Right branch response")],
        "left-child": [response("lc1", "Nested branch response")],
      },
      forkRecords,
      activeLoomId: "root",
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const rootFirst = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r1"));
    const rootSecond = projection.nodes.find((node) => node.id === responseGraphNodeId("root", "r2"));
    const leftRoot = projection.nodes.find((node) => node.id === loomGraphRootNodeId("left"));
    const rightRoot = projection.nodes.find((node) => node.id === loomGraphRootNodeId("right"));
    const nestedRoot = projection.nodes.find((node) => node.id === loomGraphRootNodeId("left-child"));

    expect(leftRoot?.position.x).toBeLessThan(rootFirst?.position.x ?? 0);
    expect(rightRoot?.position.x).toBeGreaterThan(rootSecond?.position.x ?? 0);
    expect(nestedRoot?.position.x).toBeLessThan(leftRoot?.position.x ?? 0);
    expect(leftRoot?.position.y).toBeGreaterThan(rootFirst?.position.y ?? -1);
    expect(rightRoot?.position.y).toBeGreaterThan(rootSecond?.position.y ?? -1);
    expect(nestedRoot?.position.y).toBeGreaterThan(leftRoot?.position.y ?? -1);
  });

  test("moves later branches to an open lane when a lane-depth slot is occupied", () => {
    const forkRecords: LoomForkRecord[] = [
      {
        id: "fork-root-first",
        parentConversationId: "root",
        parentResponseId: "r1",
        childConversationId: "first-branch",
        title: "First branch",
      },
      {
        id: "fork-root-later",
        parentConversationId: "root",
        parentResponseId: "r3",
        childConversationId: "later-branch",
        title: "Later branch",
      },
    ];
    const projection = buildLoomGraphProjection({
      conversations: [
        loom("root", "Root Loom"),
        loom("first-branch", "First branch"),
        loom("later-branch", "Later branch"),
      ],
      responsesByConversation: {
        root: [
          response("r1", "First origin"),
          response("r2", "Middle continuation"),
          response("r3", "Later origin"),
          response("r4", "Final continuation"),
        ],
        "first-branch": [
          response("fb1", "First branch response"),
          response("fb2", "Question labels need their own surface"),
        ],
        "later-branch": [response("lb1", "Graph continuation composer behavior")],
      },
      forkRecords,
      activeLoomId: "root",
      bookmarkedResponseAddresses: new Set<string>(),
    });

    const firstBranchSecond = projection.nodes.find((node) =>
      node.id === responseGraphNodeId("first-branch", "fb2")
    );
    const laterBranchRoot = projection.nodes.find((node) =>
      node.id === loomGraphRootNodeId("later-branch")
    );
    const occupiedPositions = new Set<string>();

    projection.nodes.forEach((node) => {
      const key = `${node.position.x}:${node.position.y}`;
      expect(occupiedPositions.has(key)).toBe(false);
      occupiedPositions.add(key);
    });
    expect(laterBranchRoot?.position.y).toBe(firstBranchSecond?.position.y);
    expect(laterBranchRoot?.position.x).not.toBe(firstBranchSecond?.position.x);
  });

  test("configures readable default zoom and hides React Flow attribution by prop", () => {
    const graphViewSource = readFileSync("src/features/graph/GraphView.tsx", "utf8");

    expect(graphViewSource).toContain("const GRAPH_DEFAULT_ZOOM = 1.08");
    expect(graphViewSource).toContain("defaultViewport={{ x: 0, y: 0, zoom: GRAPH_DEFAULT_ZOOM }}");
    expect(graphViewSource).toContain("proOptions={{ hideAttribution: true }}");
  });
});
