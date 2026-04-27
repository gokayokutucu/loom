import type { HistoryEntry, LoomLink } from "../types";

export type NavigationDirection = "back" | "forward";

export function createHistoryEntry(destination: LoomLink): HistoryEntry {
  return {
    id: `h-${Date.now()}`,
    type: destination.type,
    title: destination.title,
    path: destination.path,
    visitedAt: "Now",
  };
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
