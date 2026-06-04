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
}

export interface ConversationMinimapNearestInput {
  id: string;
  anchorTop: number;
}

const MAX_MINIMAP_LABEL_LENGTH = 120;

export function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function minimapAnchorPercent(offsetTop: number, scrollHeight: number) {
  if (!Number.isFinite(offsetTop) || scrollHeight <= 0) return 0;
  return clampPercent((offsetTop / scrollHeight) * 100);
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
}: ConversationMinimapLabelInput) {
  const fallback = type === "user" ? "User message" : type === "weft" ? "Weft" : "Response";
  const candidate = title ?? promptText ?? responseText ?? fallback;
  const normalized = candidate.replace(/\s+/g, " ").trim() || fallback;
  if (normalized.length <= MAX_MINIMAP_LABEL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_MINIMAP_LABEL_LENGTH - 1).trimEnd()}…`;
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
