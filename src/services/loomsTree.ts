/**
 * Pure helpers for the LoomsPanel lineage tree.
 *
 * These functions are extracted from App.tsx so they can be unit-tested
 * without rendering the full component.
 */

export interface LineageNode {
  id: string;
  type: "conversation" | "loom" | "response" | "quick";
  title: string;
  path: string;
  conversationId: string;
  responseId?: string;
  children: LineageNode[];
}

export interface VisibleLineageNode {
  node: LineageNode;
  depth: number;
  parentId: string | null;
  lane: number;
  hasChildren: boolean;
  collapsed: boolean;
  active: boolean;
  inActiveLineage: boolean;
  activeDescendantHidden: boolean;
}

export function containsActivePath(node: LineageNode, activePath: string): boolean {
  return node.path === activePath || node.children.some((child) => containsActivePath(child, activePath));
}

export function collectIds(node: LineageNode): string[] {
  return [node.id, ...node.children.flatMap(collectIds)];
}

export function collectCollapsibleIds(node: LineageNode): string[] {
  return [
    ...(node.children.length > 0 ? [node.id] : []),
    ...node.children.flatMap(collectCollapsibleIds),
  ];
}

/**
 * Flatten a LineageNode tree into the ordered list of visible rows.
 *
 * - Collapsed nodes emit only themselves (children hidden).
 * - Response nodes with derived Loom children (wefts) are correctly treated
 *   as parent nodes — collapsing hides the full derived-Loom subtree,
 *   expanding restores it according to each child's own collapse state.
 */
export function flattenLineageTree(
  node: LineageNode,
  collapsedIds: ReadonlySet<string>,
  activePath: string,
  depth = 0,
  parentId: string | null = null
): VisibleLineageNode[] {
  const collapsed = collapsedIds.has(node.id);
  const current: VisibleLineageNode = {
    node,
    depth,
    parentId,
    lane: depth,
    hasChildren: node.children.length > 0,
    collapsed,
    active: node.path === activePath,
    inActiveLineage: containsActivePath(node, activePath),
    activeDescendantHidden: collapsed && node.path !== activePath && containsActivePath(node, activePath),
  };
  if (collapsed) return [current];
  return [
    current,
    ...node.children.flatMap((child) =>
      flattenLineageTree(child, collapsedIds, activePath, depth + 1, node.id)
    ),
  ];
}

/**
 * Collapse all collapsible nodes that do NOT contain the active path.
 * Mirrors the "Focus current" button in LoomsPanel.
 */
export function focusActiveLineageIds(
  root: LineageNode,
  activePath: string
): Set<string> {
  return new Set(
    collectCollapsibleIds(root).filter((id) => {
      const node = findNodeById(root, id);
      return node ? !containsActivePath(node, activePath) : false;
    })
  );
}

function findNodeById(root: LineageNode, id: string): LineageNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findNodeById(child, id);
    if (match) return match;
  }
  return null;
}
