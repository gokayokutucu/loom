import { describe, expect, it } from "vitest";
import {
  graphNodeLineageRole,
  isLoomGraphDestinationNode,
  isWeftGraphNode,
  loomGraphRootNodeId,
  mergeLoomGraphAncestryStep,
  responseGraphNodeId,
  type LoomGraphProjection,
  type LoomGraphProjectionNode,
} from "./loomGraphProjection";

function makeNode(
  kind: LoomGraphProjectionNode["kind"],
  overrides: Partial<LoomGraphProjectionNode> = {}
): LoomGraphProjectionNode {
  return {
    id: `test-${kind}`,
    kind,
    loomId: "loom-1",
    title: "Test node",
    depth: 0,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

describe("isLoomGraphDestinationNode", () => {
  it("returns true for root nodes (active Loom)", () => {
    expect(isLoomGraphDestinationNode(makeNode("root"))).toBe(true);
  });

  it("returns true for weft nodes (branched Loom)", () => {
    expect(isLoomGraphDestinationNode(makeNode("weft"))).toBe(true);
  });

  it("returns true for Loom context nodes", () => {
    expect(isLoomGraphDestinationNode(makeNode("loom"))).toBe(true);
  });

  it("returns false for response nodes", () => {
    expect(isLoomGraphDestinationNode(makeNode("response"))).toBe(false);
  });

  it("returns false for bookmark nodes", () => {
    expect(isLoomGraphDestinationNode(makeNode("bookmark"))).toBe(false);
  });

  it("returns false for reference nodes", () => {
    expect(isLoomGraphDestinationNode(makeNode("reference"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// graphNodeLineageRole (Phase 4)
// ---------------------------------------------------------------------------

describe("graphNodeLineageRole", () => {
  it("returns undefined for root nodes (active Loom — no lineage role)", () => {
    expect(graphNodeLineageRole(makeNode("root"))).toBeUndefined();
  });

  it("returns 'weft' for weft nodes (branched Loom)", () => {
    expect(graphNodeLineageRole(makeNode("weft"))).toBe("weft");
  });

  it("returns explicit revision lineage for revision Weft nodes", () => {
    expect(graphNodeLineageRole(makeNode("weft", { lineageRole: "revision" }))).toBe(
      "revision"
    );
  });

  it("returns undefined for Loom context nodes", () => {
    expect(graphNodeLineageRole(makeNode("loom"))).toBeUndefined();
  });

  it("returns undefined for response nodes", () => {
    expect(graphNodeLineageRole(makeNode("response"))).toBeUndefined();
  });

  it("returns undefined for bookmark nodes", () => {
    expect(graphNodeLineageRole(makeNode("bookmark"))).toBeUndefined();
  });

  it("returns undefined for reference nodes", () => {
    expect(graphNodeLineageRole(makeNode("reference"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isWeftGraphNode (Phase 4)
// ---------------------------------------------------------------------------

describe("isWeftGraphNode", () => {
  it("returns false for root nodes (active/primary Loom)", () => {
    expect(isWeftGraphNode(makeNode("root"))).toBe(false);
  });

  it("returns true for weft nodes (branched Loom)", () => {
    expect(isWeftGraphNode(makeNode("weft"))).toBe(true);
  });

  it("returns false for Loom context nodes", () => {
    expect(isWeftGraphNode(makeNode("loom"))).toBe(false);
  });

  it("returns false for response nodes", () => {
    expect(isWeftGraphNode(makeNode("response"))).toBe(false);
  });

  it("returns false for bookmark nodes", () => {
    expect(isWeftGraphNode(makeNode("bookmark"))).toBe(false);
  });

  it("returns false for reference nodes", () => {
    expect(isWeftGraphNode(makeNode("reference"))).toBe(false);
  });
});

describe("mergeLoomGraphAncestryStep", () => {
  function baseProjection(): LoomGraphProjection {
    const originId = loomGraphRootNodeId("weft-b");
    const originResponseId = responseGraphNodeId("weft-b", "response-b");
    const currentWeftId = loomGraphRootNodeId("weft-c");
    return {
      nodes: [
        makeNode("loom", {
          id: originId,
          loomId: "weft-b",
          title: "Weft B",
          graphRole: "origin-context",
          hasParentAncestry: true,
          depth: 0,
          position: { x: 0, y: 0 },
        }),
        makeNode("response", {
          id: originResponseId,
          loomId: "weft-b",
          responseId: "response-b",
          title: "Origin response from B",
          graphRole: "origin-response",
          depth: 1,
          position: { x: 0, y: 300 },
        }),
        makeNode("weft", {
          id: currentWeftId,
          loomId: "weft-c",
          title: "Weft C",
          graphRole: "current-root",
          depth: 2,
          position: { x: 0, y: 600 },
        }),
      ],
      edges: [
        {
          id: `${originId}->${originResponseId}`,
          source: originId,
          target: originResponseId,
          kind: "question",
        },
        {
          id: `${originResponseId}->${currentWeftId}`,
          source: originResponseId,
          target: currentWeftId,
          kind: "weft",
        },
      ],
    };
  }

  it("inserts one ancestry step above the current top Loom", () => {
    const originId = loomGraphRootNodeId("weft-b");
    const projection = mergeLoomGraphAncestryStep(baseProjection(), originId, {
      loomId: "weft-b",
      hasParentAncestry: true,
      parentLoom: {
        loomId: "loom-a",
        title: "Loom A",
        kind: "loom",
        hasParentAncestry: false,
      },
      parentOriginResponse: {
        loomId: "loom-a",
        responseId: "response-a",
        title: "Response A",
      },
    });

    expect(projection.nodes.find((node) => node.loomId === "loom-a")).toMatchObject({
      kind: "loom",
      graphRole: "ancestor-context",
    });
    expect(projection.nodes.find((node) => node.responseId === "response-a")).toMatchObject({
      kind: "response",
      graphRole: "ancestor-response",
    });
    expect(projection.nodes.find((node) => node.id === originId)).toMatchObject({
      hasParentAncestry: false,
      ancestryExpanded: true,
    });
    expect(projection.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: loomGraphRootNodeId("loom-a"),
          target: responseGraphNodeId("loom-a", "response-a"),
          kind: "question",
        }),
        expect.objectContaining({
          source: responseGraphNodeId("loom-a", "response-a"),
          target: originId,
          kind: "weft",
        }),
      ])
    );
  });

  it("places expanded ancestry in a fork lane instead of the child lane", () => {
    const originId = loomGraphRootNodeId("weft-b");
    const projection = mergeLoomGraphAncestryStep(baseProjection(), originId, {
      loomId: "weft-b",
      hasParentAncestry: true,
      parentLoom: {
        loomId: "loom-a",
        title: "Loom A",
        kind: "loom",
        hasParentAncestry: false,
      },
      parentOriginResponse: {
        loomId: "loom-a",
        responseId: "response-a",
        title: "Response A",
      },
    });

    const parentLoom = projection.nodes.find((node) => node.loomId === "loom-a" && !node.responseId);
    const parentResponse = projection.nodes.find((node) => node.responseId === "response-a");
    const anchor = projection.nodes.find((node) => node.id === originId);
    const currentWeft = projection.nodes.find((node) => node.loomId === "weft-c" && !node.responseId);

    expect(parentLoom?.position.x).toBe(parentResponse?.position.x);
    expect(parentLoom?.position.x).not.toBe(anchor?.position.x);
    expect(parentResponse?.position.x).not.toBe(anchor?.position.x);
    expect(parentResponse?.position.y).toBeLessThan(anchor?.position.y ?? Number.POSITIVE_INFINITY);
    expect(currentWeft?.position).toEqual({ x: 0, y: 600 });
    expect(projection.edges).toContainEqual(
      expect.objectContaining({
        source: responseGraphNodeId("loom-a", "response-a"),
        target: originId,
        kind: "weft",
      })
    );
  });

  it("steps repeated ancestry expansion outward without overlapping parent nodes", () => {
    const originId = loomGraphRootNodeId("weft-b");
    const first = mergeLoomGraphAncestryStep(baseProjection(), originId, {
      loomId: "weft-b",
      hasParentAncestry: true,
      parentLoom: {
        loomId: "weft-a",
        title: "Weft A",
        kind: "weft",
        hasParentAncestry: true,
      },
      parentOriginResponse: {
        loomId: "weft-a",
        responseId: "response-a",
        title: "Response A",
      },
    });
    const second = mergeLoomGraphAncestryStep(first, loomGraphRootNodeId("weft-a"), {
      loomId: "weft-a",
      hasParentAncestry: true,
      parentLoom: {
        loomId: "loom-root",
        title: "Root Loom",
        kind: "loom",
        hasParentAncestry: false,
      },
      parentOriginResponse: {
        loomId: "loom-root",
        responseId: "response-root",
        title: "Root response",
      },
    });

    const firstParent = second.nodes.find((node) => node.loomId === "weft-a" && !node.responseId);
    const secondParent = second.nodes.find((node) => node.loomId === "loom-root" && !node.responseId);
    const rootResponse = second.nodes.find((node) => node.responseId === "response-root");
    const occupiedPositions = new Set(second.nodes.map((node) => `${node.position.x}:${node.position.y}`));

    expect(firstParent).toMatchObject({ kind: "weft", graphRole: "ancestor-context" });
    expect(secondParent).toMatchObject({ kind: "loom", graphRole: "ancestor-context" });
    expect(rootResponse).toMatchObject({ kind: "response", graphRole: "ancestor-response" });
    expect(secondParent?.position.x).not.toBe(firstParent?.position.x);
    expect(occupiedPositions.size).toBe(second.nodes.length);
    expect(second.nodes.some((node) => node.responseId === "unrelated-response")).toBe(false);
  });

  it("does not duplicate nodes or edges on repeated expansion", () => {
    const originId = loomGraphRootNodeId("weft-b");
    const step = {
      loomId: "weft-b",
      hasParentAncestry: true,
      parentLoom: {
        loomId: "loom-a",
        title: "Loom A",
        kind: "loom" as const,
        hasParentAncestry: false,
      },
      parentOriginResponse: {
        loomId: "loom-a",
        responseId: "response-a",
        title: "Response A",
      },
    };
    const once = mergeLoomGraphAncestryStep(baseProjection(), originId, step);
    const twice = mergeLoomGraphAncestryStep(once, originId, step);

    expect(twice.nodes.filter((node) => node.loomId === "loom-a" && !node.responseId))
      .toHaveLength(1);
    expect(twice.nodes.filter((node) => node.responseId === "response-a")).toHaveLength(1);
    expect(
      twice.edges.filter((edge) => edge.source === responseGraphNodeId("loom-a", "response-a"))
    ).toHaveLength(1);
  });
});
