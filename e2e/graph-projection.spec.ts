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

  test("configures readable default zoom and hides React Flow attribution by prop", () => {
    const graphViewSource = readFileSync("src/features/graph/GraphView.tsx", "utf8");

    expect(graphViewSource).toContain("const GRAPH_DEFAULT_ZOOM = 0.96");
    expect(graphViewSource).toContain("defaultViewport={{ x: 0, y: 0, zoom: GRAPH_DEFAULT_ZOOM }}");
    expect(graphViewSource).toContain("proOptions={{ hideAttribution: true }}");
  });
});
