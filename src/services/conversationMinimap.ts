import { cleanMarkdownDisplayText } from "./assistantMarkdown";

export interface MinimapViewportInput {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export interface MinimapViewportGeometry {
  topPercent: number;
  heightPercent: number;
}

export interface ConversationMinimapLabelInput {
  type: "user" | "response" | "queued" | "running" | "revision" | "weft";
  title?: string | null;
  promptText?: string | null;
  responseText?: string | null;
  truncate?: boolean;
}

export interface ConversationMinimapRevisionLabelInput {
  title?: string | null;
  revisionPrompt?: string | null;
}

export interface ConversationMinimapNearestInput {
  id: string;
  anchorTop: number;
}

const MAX_MINIMAP_LABEL_LENGTH = 120;
export const MINIMAP_RULER_TICK_GAP_PX = 16;
export const MINIMAP_RULER_HEIGHT_PX = 240;
export const MAX_VISIBLE_MINIMAP_RULER_TICKS = Math.min(
  20,
  Math.floor(MINIMAP_RULER_HEIGHT_PX / MINIMAP_RULER_TICK_GAP_PX) + 1
);

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function minimapAnchorPercent(offsetTop: number, scrollHeight: number) {
  if (!Number.isFinite(offsetTop) || scrollHeight <= 0) return 0;
  return clampPercent((offsetTop / scrollHeight) * 100);
}

export function minimapRulerTickPercent(index: number, itemCount: number) {
  if (itemCount <= 1 || index <= 0) return 0;
  return clampPercent((index / (itemCount - 1)) * 100);
}

export function minimapRulerTickTopPx(index: number) {
  if (index <= 0) return 0;
  return index * MINIMAP_RULER_TICK_GAP_PX;
}

export function visibleMinimapRulerWindow<T extends { id: string }>(
  items: T[],
  activeItemId: string | null,
  maxVisible = MAX_VISIBLE_MINIMAP_RULER_TICKS
) {
  if (maxVisible <= 0 || items.length <= maxVisible) return items;
  const activeIndex = Math.max(
    0,
    activeItemId ? items.findIndex((item) => item.id === activeItemId) : 0
  );
  const halfWindow = Math.floor(maxVisible / 2);
  const maxStart = items.length - maxVisible;
  const startIndex = Math.max(0, Math.min(maxStart, activeIndex - halfWindow));
  return items.slice(startIndex, startIndex + maxVisible);
}

export function minimapViewportGeometry({
  scrollTop,
  clientHeight,
  scrollHeight,
}: MinimapViewportInput): MinimapViewportGeometry {
  if (scrollHeight <= 0 || clientHeight <= 0 || scrollHeight <= clientHeight) {
    return { topPercent: 0, heightPercent: 100 };
  }
  const heightPercent = clampPercent((clientHeight / scrollHeight) * 100);
  const maxTop = 100 - heightPercent;
  const topPercent = Math.max(
    0,
    Math.min(maxTop, (scrollTop / scrollHeight) * 100)
  );
  return { topPercent, heightPercent };
}

export function conversationMinimapLabel({
  type,
  title,
  promptText,
  responseText,
  truncate = true,
}: ConversationMinimapLabelInput) {
  const fallback = type === "user" ? "User message" : type === "weft" ? "Weft" : "Response";
  const candidate = title ?? promptText ?? responseText ?? fallback;
  const normalized =
    cleanMarkdownDisplayText(candidate).replace(/\s+/g, " ").trim() || fallback;
  if (!truncate) return normalized;
  if (normalized.length <= MAX_MINIMAP_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_MINIMAP_LABEL_LENGTH - 1).trimEnd()}…`;
}

export function conversationMinimapRevisionLabel(
  revision: ConversationMinimapRevisionLabelInput,
  revisionNumber: number,
  truncate = true
) {
  const candidate = revision.revisionPrompt ?? revision.title ?? "";
  const normalized = cleanMarkdownDisplayText(candidate).replace(/\s+/g, " ").trim();
  if (normalized) {
    if (!truncate) return normalized;
    return normalized.length <= MAX_MINIMAP_LABEL_LENGTH
      ? normalized
      : `${normalized.slice(0, MAX_MINIMAP_LABEL_LENGTH - 1).trimEnd()}…`;
  }
  return Number.isFinite(revisionNumber) && revisionNumber > 1
    ? `Revision ${revisionNumber}`
    : "Revision";
}

export function nearestConversationMinimapItemId(
  items: ConversationMinimapNearestInput[],
  scrollTop: number
) {
  if (items.length === 0) return null;
  let nearest = items[0];
  let nearestDistance = Math.abs(items[0].anchorTop - scrollTop);
  for (const item of items.slice(1)) {
    const distance = Math.abs(item.anchorTop - scrollTop);
    if (distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  }
  return nearest.id;
}
