import type { LoomLink, ReferenceDisplayMode } from "../types";
import { cleanMarkdownDisplayText } from "./assistantMarkdown";

export function referenceCodeForLink(link: Pick<LoomLink, "referenceCode" | "meta">) {
  return link.referenceCode ?? link.meta?.code;
}

export function canonicalReferenceAddress(
  link: Pick<LoomLink, "canonicalUri" | "meta" | "path">
) {
  return link.canonicalUri ?? link.meta?.canonicalUri ?? link.path;
}

export function isLoomReferenceAddress(value?: string) {
  return value?.trim().startsWith("loom://") ?? false;
}

function stripReferenceSelector(value: string) {
  const hashIndex = value.indexOf("#");
  return hashIndex >= 0 ? value.slice(0, hashIndex) : value;
}

export function addressBarReferenceAddress(
  link: Pick<LoomLink, "canonicalUri" | "meta" | "path" | "sourceCanonicalUri">
) {
  const address =
    [link.sourceCanonicalUri, link.canonicalUri, link.meta?.canonicalUri, link.path].find(
      isLoomReferenceAddress
    ) ?? canonicalReferenceAddress(link);
  return stripReferenceSelector(address);
}

export function referenceDisplayModeForLink(
  link: Pick<LoomLink, "referenceDisplayMode">,
  fallback: ReferenceDisplayMode
) {
  return link.referenceDisplayMode ?? fallback;
}

export function cleanReferenceDisplayLabel(value?: string) {
  const stripped = (value ?? "")
    .replace(/\[\[|\]\]/g, " ")
    .replace(/```[a-z0-9_+#.-]*\s*/gi, " ")
    .replace(/`{1,3}/g, " ")
    .replace(/(^|\s)#{1,6}\s+/g, " ")
    .replace(/\s+#{1,6}(?=\s|$)/g, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleanMarkdownDisplayText(stripped)
    .replace(/(^|\s)#{1,6}\s+/g, " ")
    .replace(/\s+#{1,6}(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function referenceLabelForMode(
  link: Pick<
    LoomLink,
    "title" | "path" | "canonicalUri" | "meta" | "referenceCode" | "referenceCustomLabel"
  >,
  displayMode: ReferenceDisplayMode
) {
  const customLabel = cleanReferenceDisplayLabel(link.referenceCustomLabel);
  if (customLabel) return customLabel;
  const code = referenceCodeForLink(link);
  const address = canonicalReferenceAddress(link);
  const title = cleanReferenceDisplayLabel(link.title);
  if (displayMode === "code") return code ?? (title || address);
  return title || code || address;
}

export function referenceTokenText(
  link: Pick<
    LoomLink,
    | "title"
    | "path"
    | "canonicalUri"
    | "meta"
    | "referenceCode"
    | "referenceDisplayMode"
    | "referenceCustomLabel"
  >,
  fallbackDisplayMode: ReferenceDisplayMode
) {
  return `[[${referenceLabelForMode(
    link,
    referenceDisplayModeForLink(link, fallbackDisplayMode)
  )}]]`;
}

export function referenceMarkdownLink(
  link: Pick<
    LoomLink,
    | "title"
    | "path"
    | "canonicalUri"
    | "meta"
    | "referenceCode"
    | "referenceDisplayMode"
    | "referenceCustomLabel"
    | "sourceCanonicalUri"
  >,
  fallbackDisplayMode: ReferenceDisplayMode
) {
  const label = referenceLabelForMode(
    link,
    referenceDisplayModeForLink(link, fallbackDisplayMode)
  );
  return `[${label.replace(/([\\\]])/g, "\\$1")}](${canonicalReferenceAddress(link)})`;
}

export function loomLinkFromMarkdownReference(label: string, address: string): LoomLink | null {
  const trimmedAddress = address.trim();
  if (!trimmedAddress.startsWith("loom://")) return null;
  const trimmedLabel = label.trim() || trimmedAddress;
  const responseId = readResponseIdFromAddress(trimmedAddress);
  const sourceResponseId = readQueryParam(trimmedAddress, "id") ?? responseId;
  const linkType = trimmedAddress.includes("/attachment/")
    ? "attachment"
    : trimmedAddress.includes("/response/") || sourceResponseId
      ? "response"
      : "conversation";
  return {
    id: responseId ?? sourceResponseId ?? trimmedAddress,
    type: linkType,
    title: trimmedLabel,
    path: trimmedAddress,
    canonicalUri: trimmedAddress,
    sourceCanonicalUri: trimmedAddress,
    sourceResponseId,
    referenceDisplayMode: "title",
  };
}

function readQueryParam(address: string, name: string) {
  try {
    const url = new URL(address);
    return url.searchParams.get(name) ?? undefined;
  } catch {
    const match = new RegExp(`[?&]${name}=([^&#]+)`).exec(address);
    return match ? decodeURIComponent(match[1]) : undefined;
  }
}

function readResponseIdFromAddress(address: string) {
  try {
    const url = new URL(address);
    const parts = url.pathname.split("/").filter(Boolean);
    const responseIndex = parts.findIndex((part) => part === "response");
    if (responseIndex >= 0) return parts[responseIndex + 1] ?? undefined;
    return undefined;
  } catch {
    const match = /\/response\/([^/?#]+)/.exec(address);
    return match ? decodeURIComponent(match[1]) : undefined;
  }
}

export function withReferenceDisplayDefaults(
  link: LoomLink,
  fallbackDisplayMode: ReferenceDisplayMode
): LoomLink {
  return {
    ...link,
    title: cleanReferenceDisplayLabel(link.title) || link.title,
    referenceCode: referenceCodeForLink(link),
    referenceDisplayMode: referenceDisplayModeForLink(link, fallbackDisplayMode),
    referenceCustomLabel: cleanReferenceDisplayLabel(link.referenceCustomLabel) || undefined,
  };
}
