import type { HistoryEntry, LoomLink, LoomNavigationDestination } from "../types";

export type NavigationDirection = "back" | "forward";
const TRAVERSAL_MENU_LIMIT = 16;

export interface NavigationTraversalEntry {
  entry: HistoryEntry;
  index: number;
}

export function createHistoryEntry(
  destination: LoomLink,
  navigationDestination?: LoomNavigationDestination
): HistoryEntry {
  return {
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: destination.type,
    title: destination.title,
    path: destination.path,
    visitedAt: "Now",
    navigationDestination,
  };
}

export function destinationsEqual(
  left?: LoomNavigationDestination,
  right?: LoomNavigationDestination
) {
  if (!left || !right) return false;
  return (
    left.loomId === right.loomId &&
    left.mode === right.mode &&
    left.originLoomId === right.originLoomId &&
    left.originResponseId === right.originResponseId &&
    left.scrollTargetResponseId === right.scrollTargetResponseId &&
    left.scrollMode === right.scrollMode
  );
}

export function historyEntryMatchesDestination(
  entry: HistoryEntry | undefined,
  link: Pick<LoomLink, "path" | "title">,
  destination: LoomNavigationDestination
) {
  if (!entry) return false;
  return (
    entry.path === link.path &&
    entry.title === link.title &&
    destinationsEqual(entry.navigationDestination, destination)
  );
}

export function markHistoryOlder(history: HistoryEntry[]) {
  return history.map((entry, index) => ({
    ...entry,
    visitedAt: index === 0 ? "Earlier today" : entry.visitedAt,
  }));
}

export function nextHistoryCursor(
  direction: NavigationDirection,
  cursor: number,
  history: HistoryEntry[]
) {
  const nextCursor = direction === "back" ? cursor + 1 : Math.max(cursor - 1, 0);
  return history[nextCursor] ? nextCursor : cursor;
}

export function historyMenuEntries(
  direction: NavigationDirection,
  history: HistoryEntry[],
  cursor: number
) {
  if (direction === "back") return history.slice(cursor + 1, cursor + 6);
  return history.slice(0, cursor).slice(-5).reverse();
}

export function getBackTraversal(
  stack: HistoryEntry[],
  cursor: number
): NavigationTraversalEntry[] {
  return stack
    .slice(0, cursor)
    .map((entry, index) => ({ entry, index }))
    .reverse()
    .slice(0, TRAVERSAL_MENU_LIMIT);
}

export function getForwardTraversal(
  stack: HistoryEntry[],
  cursor: number
): NavigationTraversalEntry[] {
  return stack
    .slice(cursor + 1)
    .map((entry, offset) => ({ entry, index: cursor + 1 + offset }))
    .slice(0, TRAVERSAL_MENU_LIMIT);
}

export function jumpToTraversalIndex(
  stack: HistoryEntry[],
  targetIndex: number
) {
  return stack[targetIndex] ? targetIndex : undefined;
}
