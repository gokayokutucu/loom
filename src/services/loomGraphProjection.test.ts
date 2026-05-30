import { describe, expect, it } from "vitest";
import {
  graphNodeLineageRole,
  isLoomGraphDestinationNode,
  isWeftGraphNode,
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
