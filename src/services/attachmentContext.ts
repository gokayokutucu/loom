/**
 * Attachment context utilities shared between the engine client and tests.
 */

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
