/**
 * Attachment context utilities shared between the engine client and tests.
 */
import type { LoomLink } from "../types";

/**
 * Minimal attachment shape required to build a questionReferences LoomLink.
 * A subset of ComposerAttachment (App.tsx) — allows this module to be
 * imported and tested without pulling the full App component graph.
 */
export interface AttachmentForReference {
  /** Local pending key ("name:size:lastModified") or service-issued "att-…" ID. */
  id: string;
  /** Service-issued ID once upload completes. Preferred over `id` when present. */
  attachmentId?: string;
  name: string;
  loomId?: string;
  parseStatus?: string;
  kind?: string;
}

/**
 * Returns true if a LoomLink represents an uploaded file attachment.
 * Used to detect attachment links that should render in SentAttachmentChips
 * rather than as inline reference chips.
 */
export function isAttachmentLink(
  link: Pick<LoomLink, "type" | "targetKind">
): boolean {
  return link.type === "attachment" || link.targetKind === "attachment";
}

/**
 * Merge tray attachments into the questionReferences array so they survive
 * send and app reload and can be rendered as SentAttachmentChips.
 *
 * Tray attachments arrive separately as `attachments[]` in the send payload
 * and are NOT automatically in `questionReferences`. This function converts
 * them to LoomLink objects and appends them, deduplicating against any
 * attachment links already present (e.g. explicitly-inserted inline tokens).
 *
 * Rules:
 * - Deduplication is by resolved attachment ID (attachmentId ?? id).
 * - Only persisted ("att-…") IDs produce usable chips after reload; pending
 *   local keys are included so chips appear immediately but will not resolve
 *   after a cold reload if the upload was interrupted.
 * - Order: existing links first, then tray attachments in original order.
 */
export function mergeAttachmentLinksForSend(
  existingLinks: LoomLink[],
  attachments: AttachmentForReference[] | undefined
): LoomLink[] {
  if (!attachments?.length) return existingLinks;
  const existingIds = new Set(
    existingLinks.filter(isAttachmentLink).map((l) => l.id)
  );
  const newLinks = attachments
    .filter((a) => !existingIds.has(a.attachmentId ?? a.id))
    .map((a): LoomLink => {
      const attachmentId = a.attachmentId ?? a.id;
      const path = a.loomId
        ? `loom://${a.loomId}/attachments/${attachmentId}`
        : `loom://attachments/${attachmentId}`;
      return {
        id: attachmentId,
        type: "attachment",
        title: a.name,
        path,
        badge:
          a.parseStatus === "unsupported"
            ? "Unsupported file"
            : a.kind === "image"
              ? "Image"
              : "File",
        targetObjectId: attachmentId,
        targetKind: "attachment",
        canonicalUri: path,
      };
    });
  return [...existingLinks, ...newLinks];
}

/**
 * Returns true if the given attachment ID was issued by the service
 * (format: "att-XXXXXXXX"). Filters out local pending keys like
 * "name:size:lastModified" which have not yet been uploaded.
 */
export function isPersistedAttachmentId(id: string): boolean {
  return typeof id === "string" && id.startsWith("att-");
}

/**
 * Truncates a filename for display while preserving the extension.
 * Appends "…" when truncation occurs.
 */
export function truncateFilenameForDisplay(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx > 0 ? name.slice(dotIdx) : "";
  const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const keepStem = maxLen - ext.length - 1;
  if (keepStem <= 0) return name.slice(0, maxLen) + "…";
  return stem.slice(0, keepStem) + "…" + ext;
}
