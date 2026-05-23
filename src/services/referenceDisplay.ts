import type { LoomLink, ReferenceDisplayMode } from "../types";

export function referenceCodeForLink(link: Pick<LoomLink, "referenceCode" | "meta">) {
  return link.referenceCode ?? link.meta?.code;
}

export function canonicalReferenceAddress(
  link: Pick<LoomLink, "canonicalUri" | "meta" | "path">
) {
  return link.canonicalUri ?? link.meta?.canonicalUri ?? link.path;
}

export function referenceDisplayModeForLink(
  link: Pick<LoomLink, "referenceDisplayMode">,
  fallback: ReferenceDisplayMode
) {
  return link.referenceDisplayMode ?? fallback;
}

export function referenceLabelForMode(
  link: Pick<
    LoomLink,
    "title" | "path" | "canonicalUri" | "meta" | "referenceCode" | "referenceCustomLabel"
  >,
  displayMode: ReferenceDisplayMode
) {
  const customLabel = link.referenceCustomLabel?.trim();
  if (customLabel) return customLabel;
  const code = referenceCodeForLink(link);
  const address = canonicalReferenceAddress(link);
  if (displayMode === "code") return code ?? link.title ?? address;
  return link.title ?? code ?? address;
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

export function withReferenceDisplayDefaults(
  link: LoomLink,
  fallbackDisplayMode: ReferenceDisplayMode
): LoomLink {
  return {
    ...link,
    referenceCode: referenceCodeForLink(link),
    referenceDisplayMode: referenceDisplayModeForLink(link, fallbackDisplayMode),
    referenceCustomLabel: link.referenceCustomLabel?.trim() || undefined,
  };
}
