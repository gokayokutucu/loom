import type { LoomLink } from "../types";

export function normalizeReferenceAddress(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

export function responseIdFromReferenceAddress(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.searchParams.get("id") ?? undefined;
  } catch {
    const match = /[?&]id=([^&#]+)/.exec(value);
    return match ? decodeURIComponent(match[1]) : undefined;
  }
}

export function normalizeResponseLinkSource(link: LoomLink): LoomLink {
  if (link.type !== "response") return link;
  const canonicalUri = link.canonicalUri ?? link.meta?.canonicalUri ?? link.path;
  const path = canonicalUri || link.path || link.sourceCanonicalUri || link.id;
  const addressResponseId =
    responseIdFromReferenceAddress(canonicalUri) ??
    responseIdFromReferenceAddress(path) ??
    responseIdFromReferenceAddress(link.sourceCanonicalUri);

  return {
    ...link,
    path,
    canonicalUri,
    sourceCanonicalUri:
      normalizeReferenceAddress(link.sourceCanonicalUri) ===
      normalizeReferenceAddress(canonicalUri)
        ? link.sourceCanonicalUri
        : canonicalUri,
    sourceResponseId: addressResponseId ?? link.sourceResponseId,
  };
}

export function selectedReferenceKeysForLink(link: LoomLink) {
  const stableLink = normalizeResponseLinkSource(link);
  const keys = new Set<string>();
  if (
    stableLink.type === "fragment" &&
    stableLink.sourceLoomId &&
    stableLink.sourceResponseId &&
    stableLink.fragmentHash
  ) {
    keys.add(
      `fragment:${stableLink.sourceLoomId}:${stableLink.sourceResponseId}:${stableLink.fragmentHash}`
    );
  }
  if (stableLink.type === "response" && stableLink.id) {
    keys.add(`response:${stableLink.id}`);
  }
  if (stableLink.targetObjectId) keys.add(`object:${stableLink.targetObjectId}`);
  if (stableLink.canonicalUri) {
    keys.add(`canonical:${normalizeReferenceAddress(stableLink.canonicalUri)}`);
  }
  if (stableLink.sourceCanonicalUri) {
    keys.add(`canonical:${normalizeReferenceAddress(stableLink.sourceCanonicalUri)}`);
  }
  if (stableLink.path) keys.add(`address:${normalizeReferenceAddress(stableLink.path)}`);
  if (keys.size === 0) keys.add(`fallback:${stableLink.type}:${stableLink.id}`);
  return Array.from(keys);
}

export function referencesShareIdentity(a: LoomLink, b: LoomLink) {
  const aKeys = new Set(selectedReferenceKeysForLink(a));
  return selectedReferenceKeysForLink(b).some((key) => aKeys.has(key));
}

export function referenceIdentityKey(link: LoomLink) {
  return selectedReferenceKeysForLink(link)[0] ?? `${link.type}:${link.id}:${link.path}`;
}
