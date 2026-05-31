import { describe, expect, it } from "vitest";
import {
  collectCollapsibleIds,
  collapseAllLineageIds,
  collectIds,
  expandAllLineageIds,
  flattenLineageTree,
  focusActiveLineageIds,
  type LineageNode,
} from "./loomsTree";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: LineageNode["type"],
  path: string,
  children: LineageNode[] = []
): LineageNode {
  return {
    id,
    type,
    title: id,
    path,
    conversationId: id,
    children,
  };
}

/**
 * Tree:
 *   root (conversation, active)
 *     └─ response-r1 (response, has derived Loom child)
 *          └─ weft-a (loom)
 *               └─ response-ra1 (response, has derived Loom child)
 *                    └─ weft-b (loom, leaf)
 */
function mainLoomTree(): LineageNode {
  const weftB = makeNode("weft-b", "loom", "loom://wefts/weft-b");
  const responseRA1 = makeNode("response-ra1", "response", "loom://r/ra1", [weftB]);
  const weftA = makeNode("weft-a", "loom", "loom://wefts/weft-a", [responseRA1]);
  const responseR1 = makeNode("response-r1", "response", "loom://r/r1", [weftA]);
  return makeNode("root", "conversation", "loom://root", [responseR1]);
}

const ACTIVE_PATH = "loom://root";

// ---------------------------------------------------------------------------
// flattenLineageTree
// ---------------------------------------------------------------------------

describe("flattenLineageTree", () => {
  it("includes derived Loom child under Response when nothing is collapsed", () => {
    const tree = mainLoomTree();
    const visible = flattenLineageTree(tree, new Set(), ACTIVE_PATH);
    const ids = visible.map((v) => v.node.id);

    expect(ids).toContain("response-r1");
    expect(ids).toContain("weft-a");
    expect(ids).toContain("response-ra1");
    expect(ids).toContain("weft-b");
  });

  it("marks Response nodes with derived Loom children as hasChildren", () => {
    const tree = mainLoomTree();
    const visible = flattenLineageTree(tree, new Set(), ACTIVE_PATH);

    const r1 = visible.find((v) => v.node.id === "response-r1");
    const ra1 = visible.find((v) => v.node.id === "response-ra1");

    expect(r1?.hasChildren).toBe(true);
    expect(ra1?.hasChildren).toBe(true);
  });

  it("collapsing a Response hides its entire derived Loom subtree", () => {
    const tree = mainLoomTree();
    const collapsed = new Set(["response-r1"]);
    const visible = flattenLineageTree(tree, collapsed, ACTIVE_PATH);
    const ids = visible.map((v) => v.node.id);

    expect(ids).toContain("response-r1"); // row itself still visible (shows collapse indicator)
    expect(ids).not.toContain("weft-a");
    expect(ids).not.toContain("response-ra1");
    expect(ids).not.toContain("weft-b");
  });

  it("expanding a Response restores the derived Loom subtree", () => {
    const tree = mainLoomTree();
    // Start collapsed
    const collapsedBefore = new Set(["response-r1"]);
    const visibleBefore = flattenLineageTree(tree, collapsedBefore, ACTIVE_PATH);
    expect(visibleBefore.map((v) => v.node.id)).not.toContain("weft-a");

    // Expand (remove response-r1 from collapsedIds)
    const collapsedAfter = new Set<string>();
    const visibleAfter = flattenLineageTree(tree, collapsedAfter, ACTIVE_PATH);
    const ids = visibleAfter.map((v) => v.node.id);

    expect(ids).toContain("weft-a");
    expect(ids).toContain("response-ra1");
    expect(ids).toContain("weft-b");
  });

  it("grandchild derived Loom remains visible after expanding its parent Response", () => {
    const tree = mainLoomTree();
    // Only response-r1 was collapsed; response-ra1 was NOT individually collapsed
    const collapsedAfter = new Set<string>();
    const visible = flattenLineageTree(tree, collapsedAfter, ACTIVE_PATH);
    const ids = visible.map((v) => v.node.id);

    // weft-b (grandchild) should be visible since neither its parent nor grandparent is collapsed
    expect(ids).toContain("weft-b");
  });

  it("collapsing an intermediate Weft hides its descendants but not siblings", () => {
    const tree = mainLoomTree();
    // Collapse weft-a; response-r1 is still expanded
    const collapsed = new Set(["weft-a"]);
    const visible = flattenLineageTree(tree, collapsed, ACTIVE_PATH);
    const ids = visible.map((v) => v.node.id);

    expect(ids).toContain("response-r1"); // parent of weft-a still visible
    expect(ids).toContain("weft-a");       // weft-a itself visible (collapsed)
    expect(ids).not.toContain("response-ra1"); // hidden under collapsed weft-a
    expect(ids).not.toContain("weft-b");       // hidden under collapsed weft-a
  });

  it("Expand all (empty collapsedIds) produces the same full tree as initial full-expand", () => {
    const tree = mainLoomTree();
    const fullExpand = flattenLineageTree(tree, new Set(), ACTIVE_PATH);

    // Simulate user collapsing response-r1 then pressing Expand all
    const afterExpandAll = flattenLineageTree(tree, new Set(), ACTIVE_PATH);

    expect(afterExpandAll.map((v) => v.node.id)).toEqual(fullExpand.map((v) => v.node.id));
  });

  it("expanding Response individually (toggle) and Expand-all produce same visible set when no child is individually collapsed", () => {
    const tree = mainLoomTree();
    // Only response-r1 was collapsed; nothing else
    const afterToggle = flattenLineageTree(tree, new Set<string>(), ACTIVE_PATH);
    const afterExpandAll = flattenLineageTree(tree, new Set<string>(), ACTIVE_PATH);

    expect(afterToggle.map((v) => v.node.id)).toEqual(afterExpandAll.map((v) => v.node.id));
  });

  it("does not duplicate derived Loom branches after repeated expand/collapse cycles", () => {
    const tree = mainLoomTree();
    // collapse → expand → collapse → expand
    const step1 = new Set(["response-r1"]);
    const step2 = new Set<string>();
    const step3 = new Set(["response-r1"]);
    const step4 = new Set<string>();

    const v1 = flattenLineageTree(tree, step1, ACTIVE_PATH).map((v) => v.node.id);
    const v2 = flattenLineageTree(tree, step2, ACTIVE_PATH).map((v) => v.node.id);
    const v3 = flattenLineageTree(tree, step3, ACTIVE_PATH).map((v) => v.node.id);
    const v4 = flattenLineageTree(tree, step4, ACTIVE_PATH).map((v) => v.node.id);

    expect(new Set(v1).size).toBe(v1.length); // no duplicates
    expect(new Set(v2).size).toBe(v2.length);
    expect(new Set(v3).size).toBe(v3.length);
    expect(new Set(v4).size).toBe(v4.length);
    expect(v2).toEqual(v4); // same full tree after any number of cycles
  });

  it("Revision derived Loom branches behave the same as Weft branches", () => {
    const revisionLoom = makeNode("revision-a", "loom", "loom://looms/revision-a");
    const revisionResponse = makeNode("revision-r1", "response", "loom://r/rev-r1", [revisionLoom]);
    const root = makeNode("root", "conversation", "loom://root", [revisionResponse]);

    const collapsed = new Set(["revision-r1"]);
    const visCollapsed = flattenLineageTree(root, collapsed, "loom://root");
    expect(visCollapsed.map((v) => v.node.id)).not.toContain("revision-a");

    const visExpanded = flattenLineageTree(root, new Set(), "loom://root");
    expect(visExpanded.map((v) => v.node.id)).toContain("revision-a");
  });
});

// ---------------------------------------------------------------------------
// collectIds — used by "Expand Branch" context menu action
// ---------------------------------------------------------------------------

describe("collectIds", () => {
  it("returns node id and all descendant ids", () => {
    const tree = mainLoomTree();
    const r1 = tree.children[0]; // response-r1
    const ids = collectIds(r1);

    expect(ids).toContain("response-r1");
    expect(ids).toContain("weft-a");
    expect(ids).toContain("response-ra1");
    expect(ids).toContain("weft-b");
  });
});

// ---------------------------------------------------------------------------
// focusActiveLineageIds — mirrors "Focus current" button
// ---------------------------------------------------------------------------

describe("focusActiveLineageIds", () => {
  it("collapses non-active branches while keeping active lineage open", () => {
    const tree = mainLoomTree();
    const collapsed = focusActiveLineageIds(tree, ACTIVE_PATH);

    // response-r1 does not contain the active path (root), so it should be collapsed
    expect(collapsed.has("response-r1")).toBe(true);
    // weft-a and response-ra1 also don't contain active
    expect(collapsed.has("weft-a")).toBe(true);
    expect(collapsed.has("response-ra1")).toBe(true);
    // root itself contains the active path, so it should NOT be collapsed
    expect(collapsed.has("root")).toBe(false);
  });

  it("after Focus-current expanding a Response removes its own ID from collapsedIds (toggle)", () => {
    const tree = mainLoomTree();
    // Simulate Focus current → collapsedIds has response-r1 and weft-a
    const collapsedAfterFocus = focusActiveLineageIds(tree, ACTIVE_PATH);
    expect(collapsedAfterFocus.has("response-r1")).toBe(true);

    // User expands response-r1 via toggle (ArrowRight / context menu expand)
    const afterExpand = new Set(collapsedAfterFocus);
    collectIds(tree.children[0]).forEach((id) => afterExpand.delete(id));

    // All of response-r1's subtree should be gone from collapsedIds
    expect(afterExpand.has("response-r1")).toBe(false);
    expect(afterExpand.has("weft-a")).toBe(false);
    expect(afterExpand.has("response-ra1")).toBe(false);

    // After full expand: full subtree visible
    const visible = flattenLineageTree(tree, afterExpand, ACTIVE_PATH);
    const ids = visible.map((v) => v.node.id);
    expect(ids).toContain("weft-a");
    expect(ids).toContain("response-ra1");
    expect(ids).toContain("weft-b");
  });
});

// ---------------------------------------------------------------------------
// collectCollapsibleIds — prerequisite for Collapse all / Focus current
// ---------------------------------------------------------------------------

describe("collectCollapsibleIds", () => {
  it("includes Response nodes that have derived Loom children", () => {
    const tree = mainLoomTree();
    const ids = collectCollapsibleIds(tree);
    expect(ids).toContain("response-r1");
    expect(ids).toContain("response-ra1");
  });

  it("includes Weft/Loom nodes that have response children", () => {
    const tree = mainLoomTree();
    const ids = collectCollapsibleIds(tree);
    expect(ids).toContain("weft-a");
    expect(ids).toContain("root");
  });

  it("excludes leaf nodes with no children", () => {
    const tree = mainLoomTree();
    const ids = collectCollapsibleIds(tree);
    expect(ids).not.toContain("weft-b");
  });
});

// ---------------------------------------------------------------------------
// collapseAllLineageIds — "Collapse all" button
// ---------------------------------------------------------------------------

describe("collapseAllLineageIds", () => {
  it("collapses all nodes with children except the root", () => {
    const tree = mainLoomTree();
    const collapsed = collapseAllLineageIds(tree);

    expect(collapsed.has("root")).toBe(false);
    expect(collapsed.has("response-r1")).toBe(true);
    expect(collapsed.has("weft-a")).toBe(true);
    expect(collapsed.has("response-ra1")).toBe(true);
    expect(collapsed.has("weft-b")).toBe(false);
  });

  it("hides all descendants below root after Collapse all", () => {
    const tree = mainLoomTree();
    const collapsed = collapseAllLineageIds(tree);
    const visible = flattenLineageTree(tree, collapsed, ACTIVE_PATH);
    const ids = visible.map((v) => v.node.id);

    expect(ids).toContain("root");
    expect(ids).toContain("response-r1");
    expect(ids).not.toContain("weft-a");
    expect(ids).not.toContain("response-ra1");
    expect(ids).not.toContain("weft-b");
  });

  it("Expand all after Collapse all restores the full tree", () => {
    const tree = mainLoomTree();
    const collapsedAll = collapseAllLineageIds(tree);
    const expandedAll = expandAllLineageIds();

    const afterExpand = flattenLineageTree(tree, expandedAll, ACTIVE_PATH);
    const ids = afterExpand.map((v) => v.node.id);

    expect(ids).toContain("root");
    expect(ids).toContain("response-r1");
    expect(ids).toContain("weft-a");
    expect(ids).toContain("response-ra1");
    expect(ids).toContain("weft-b");
    expect(new Set(ids).size).toBe(ids.length);
    expect(collapsedAll.size).toBeGreaterThan(0);
    expect(expandedAll.size).toBe(0);
  });

  it("Collapse all after Expand all hides all branches again", () => {
    const tree = mainLoomTree();
    const collapsed = collapseAllLineageIds(tree);
    const visible = flattenLineageTree(tree, collapsed, ACTIVE_PATH);
    expect(visible.map((v) => v.node.id)).not.toContain("weft-b");
  });

  it("no duplicate rows after repeated Collapse/Expand cycles", () => {
    const tree = mainLoomTree();
    for (let i = 0; i < 3; i++) {
      const c = flattenLineageTree(tree, collapseAllLineageIds(tree), ACTIVE_PATH).map((v) => v.node.id);
      const e = flattenLineageTree(tree, expandAllLineageIds(), ACTIVE_PATH).map((v) => v.node.id);
      expect(new Set(c).size).toBe(c.length);
      expect(new Set(e).size).toBe(e.length);
    }
  });
});

// ---------------------------------------------------------------------------
// expandAllLineageIds — "Expand all" button
// ---------------------------------------------------------------------------

describe("expandAllLineageIds", () => {
  it("returns an empty set", () => {
    expect(expandAllLineageIds().size).toBe(0);
  });

  it("makes the full recursive tree visible regardless of prior collapse state", () => {
    const tree = mainLoomTree();
    const heavyCollapse = focusActiveLineageIds(tree, "loom://root");
    expect(heavyCollapse.size).toBeGreaterThan(0);

    const visible = flattenLineageTree(tree, expandAllLineageIds(), ACTIVE_PATH);
    const ids = visible.map((v) => v.node.id);
    expect(ids).toContain("weft-a");
    expect(ids).toContain("response-ra1");
    expect(ids).toContain("weft-b");
  });
});

// ---------------------------------------------------------------------------
// focusActiveLineageIds — "Focus current" bulk action edge cases
// ---------------------------------------------------------------------------

describe("focusActiveLineageIds — bulk action edge cases", () => {
  it("works when active node is inside a grandchild Weft", () => {
    const tree = mainLoomTree();
    const collapsed = focusActiveLineageIds(tree, "loom://wefts/weft-b");

    expect(collapsed.has("root")).toBe(false);
    expect(collapsed.has("response-r1")).toBe(false);
    expect(collapsed.has("weft-a")).toBe(false);
    expect(collapsed.has("response-ra1")).toBe(false);
    expect(collapsed.has("weft-b")).toBe(false);
  });

  it("collapses sibling branches when active node is nested", () => {
    const siblingWeft = makeNode("weft-sibling", "loom", "loom://wefts/sibling");
    const siblingResp = makeNode("response-r2", "response", "loom://r/r2", [siblingWeft]);
    const weftB = makeNode("weft-b", "loom", "loom://wefts/weft-b");
    const responseRA1 = makeNode("response-ra1", "response", "loom://r/ra1", [weftB]);
    const weftA = makeNode("weft-a", "loom", "loom://wefts/weft-a", [responseRA1]);
    const responseR1 = makeNode("response-r1", "response", "loom://r/r1", [weftA]);
    const root = makeNode("root", "conversation", "loom://root", [responseR1, siblingResp]);

    const collapsed = focusActiveLineageIds(root, "loom://wefts/weft-b");

    expect(collapsed.has("response-r2")).toBe(true);
    expect(collapsed.has("response-r1")).toBe(false);
    expect(collapsed.has("weft-a")).toBe(false);
  });

  it("Expand all after Focus current restores all branches", () => {
    const tree = mainLoomTree();
    const afterFocus = focusActiveLineageIds(tree, ACTIVE_PATH);
    expect(afterFocus.size).toBeGreaterThan(0);

    const visible = flattenLineageTree(tree, expandAllLineageIds(), ACTIVE_PATH);
    const ids = visible.map((v) => v.node.id);
    expect(ids).toContain("weft-a");
    expect(ids).toContain("weft-b");
  });
});
