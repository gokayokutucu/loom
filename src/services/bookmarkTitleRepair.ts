import type { BookmarkItem, Conversation } from "../types";
import { cleanMarkdownDisplayText } from "./assistantMarkdown";
import { polishDisplayTitle } from "./displayTitlePolish";

function cleanBookmarkTitle(value?: string) {
  const normalized = (value ?? "")
    .replace(/\[\[|\]\]/g, " ")
    .replace(/```[a-z0-9_+#.-]*\s*/gi, " ")
    .replace(/`{1,3}/g, " ")
    .replace(/(^|\s)#{1,6}\s+/g, " ")
    .replace(/\s+#{1,6}(?=\s|$)/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return (
    polishDisplayTitle(cleanMarkdownDisplayText(normalized)) ||
    normalized
  );
}

export function isRawInternalBookmarkTitle(value?: string, targetObjectId?: string) {
  const normalized = cleanBookmarkTitle(value);
  const lower = normalized.toLocaleLowerCase();
  const targetLower = targetObjectId?.trim().toLocaleLowerCase();
  return (
    !normalized ||
    lower === "unknown" ||
    lower === "untitled loom" ||
    (Boolean(targetLower) && lower === targetLower) ||
    /^c[-_][a-z0-9-]+$/i.test(normalized) ||
    /^weft-response-workflow[-_][a-z0-9-]+$/i.test(normalized) ||
    /^temp-weft[-_][a-z0-9-]+$/i.test(normalized)
  );
}

export function readableTitleFromLoomPath(value?: string) {
  if (!value) return "";
  const withoutQuery = value.split("?")[0] ?? "";
  const segment = withoutQuery
    .replace(/^loom:\/\//i, "")
    .split("/")
    .find((part) => {
      const cleaned = part.trim();
      return (
        cleaned.length > 0 &&
        !/^l[-_][a-z0-9-]+$/i.test(cleaned) &&
        !/^r[-_][a-z0-9-]+$/i.test(cleaned) &&
        !/^cnv[-_][a-z0-9-]+$/i.test(cleaned)
      );
    });
  if (!segment) return "";
  try {
    return cleanBookmarkTitle(decodeURIComponent(segment).replace(/[-_]+/g, " "));
  } catch {
    return cleanBookmarkTitle(segment.replace(/[-_]+/g, " "));
  }
}

export function resolveLoomBookmarkTitle(options: {
  liveConversationTitle?: string;
  activeAddressableConversationTitle?: string;
  serviceTitle?: string;
  destinationTitle?: string;
  path?: string;
  canonicalUri?: string;
  fallbackId?: string;
}) {
  const candidates = [
    options.liveConversationTitle,
    options.activeAddressableConversationTitle,
    options.serviceTitle,
    options.destinationTitle,
    readableTitleFromLoomPath(options.canonicalUri),
    readableTitleFromLoomPath(options.path),
  ];
  for (const candidate of candidates) {
    const cleaned = cleanBookmarkTitle(candidate);
    if (cleaned && !isRawInternalBookmarkTitle(cleaned, options.fallbackId)) return cleaned;
  }
  return cleanBookmarkTitle(options.fallbackId) || "Loom";
}

function isLoomLevelBookmark(bookmark: BookmarkItem) {
  return (
    bookmark.targetKind === "loom" ||
    bookmark.targetKind === "weft" ||
    bookmark.type === "conversation" ||
    bookmark.type === "loom"
  );
}

function conversationMatchesBookmark(conversation: Conversation, bookmark: BookmarkItem) {
  const targetObjectId = bookmark.targetObjectId?.trim();
  const conversationObjectId = `CNV_${conversation.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return (
    targetObjectId === conversation.id ||
    targetObjectId === conversationObjectId ||
    bookmark.id === conversation.id ||
    bookmark.path === conversation.path ||
    bookmark.canonicalUri === conversation.path ||
    bookmark.path === conversation.meta?.canonicalUri ||
    bookmark.canonicalUri === conversation.meta?.canonicalUri
  );
}

export function repairHydratedLoomBookmarkTitle(
  bookmark: BookmarkItem,
  conversations: Conversation[]
) {
  if (!isLoomLevelBookmark(bookmark)) return bookmark;
  const currentTitle = bookmark.editableTitle || bookmark.title;
  if (!isRawInternalBookmarkTitle(currentTitle, bookmark.targetObjectId)) return bookmark;
  const conversation = conversations.find((item) => conversationMatchesBookmark(item, bookmark));
  if (!conversation) return bookmark;
  const title = resolveLoomBookmarkTitle({
    liveConversationTitle: conversation.title,
    serviceTitle: currentTitle,
    path: conversation.path || bookmark.path,
    canonicalUri: conversation.meta?.canonicalUri ?? bookmark.canonicalUri,
    fallbackId: conversation.id,
  });
  return {
    ...bookmark,
    title,
    editableTitle: title,
    path: bookmark.path || conversation.path,
    canonicalUri: bookmark.canonicalUri ?? conversation.meta?.canonicalUri,
    meta: bookmark.meta ?? conversation.meta,
    referenceCode: bookmark.referenceCode ?? conversation.meta?.displayCode ?? conversation.meta?.code,
  };
}
