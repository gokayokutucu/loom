// Bookmark identity model for Loom's canonical address authority.
//
// CORE RULE: Bookmark identity derives from canonical target tuple:
//   (targetKind, loomId, responseId)
// NOT from display codes, R-XXXXX badges, visible titles, or path strings.
//
// Display codes (displayCode, referenceCode, R-XXXXX) are UI labels only.
// They MUST NOT appear in identity keys or matching logic.
//
// Identity types are mutually exclusive:
//   - Loom bookmark    → "loom:<loomId>"
//   - Response bookmark → "response:<responseId>"   (loomId omitted: same responseId is globally unique)
//   - Weft bookmark    → "weft:<loomId>"
//
// A response bookmark MUST NEVER match a loom/conversation destination
// and vice versa.

import type { BookmarkItem, LoomLink, ResponseItem } from "../types";
import { responseIdFromReferenceAddress } from "./referenceIdentity";

// ── Canonical target key ──────────────────────────────────────────────────────

/**
 * Stable opaque key that identifies WHAT a bookmark points at.
 * Uses raw IDs only — never display codes.
 *
 *   loom bookmark     → "loom:<targetObjectId|path>"
 *   response bookmark → "response:<targetObjectId>"
 *   weft bookmark     → "weft:<targetObjectId|path>"
 *
 * Use this to deduplicate bookmarks and to test isolation between types.
 */
export function bookmarkTargetKey(bookmark: BookmarkItem): string {
  const id =
    bookmark.targetObjectId ??
    responseIdFromReferenceAddress(bookmark.canonicalUri) ??
    responseIdFromReferenceAddress(bookmark.path) ??
    bookmark.sourceResponseId ??
    bookmark.canonicalUri ??
    bookmark.path;

  if (bookmark.type === "response") return `response:${id ?? bookmark.id}`;
  return `loom:${id ?? bookmark.id}`;
}

/**
 * Stable opaque key for a destination link.
 * Mirrors bookmarkTargetKey so the two can be compared directly.
 */
export function destinationTargetKey(destination: LoomLink): string {
  const id =
    destination.targetObjectId ??
    responseIdFromReferenceAddress(destination.canonicalUri) ??
    responseIdFromReferenceAddress(destination.path) ??
    destination.sourceResponseId ??
    destination.id ??
    destination.canonicalUri ??
    destination.path;

  if (destination.type === "response") return `response:${id}`;
  return `loom:${id}`;
}

/**
 * Stable opaque key derived from a ResponseItem.
 * Uses the raw response UUID — never the display code.
 */
export function responseTargetKey(response: ResponseItem): string {
  const id =
    response.id ??
    response.serviceUserResponseId ??
    response.meta?.id;
  return `response:${id}`;
}

// ── Candidate sets ────────────────────────────────────────────────────────────

/**
 * All identity tokens a bookmark could be matched by.
 *
 * Includes the ?id=responseId extracted from path/canonicalUri so bookmarks
 * created when a response had no display code (path contained R-00000 fallback)
 * still match once the response receives its real code.
 */
export function bookmarkIdentityCandidates(bookmark: BookmarkItem): Set<string> {
  return new Set(
    [
      bookmark.path,
      bookmark.canonicalUri,
      bookmark.targetObjectId,
      bookmark.sourceResponseId,
      bookmark.sourceCanonicalUri,
      // Extract the stable ?id=responseId from URL-shaped paths.
      // This is the same extraction linkIdentityCandidates already performs,
      // making bookmark ↔ link candidate matching fully symmetric.
      responseIdFromReferenceAddress(bookmark.path),
      responseIdFromReferenceAddress(bookmark.canonicalUri),
      responseIdFromReferenceAddress(bookmark.sourceCanonicalUri),
      bookmark.meta?.id,
      bookmark.meta?.canonicalUri,
      responseIdFromReferenceAddress(bookmark.meta?.canonicalUri),
    ].filter((v): v is string => Boolean(v))
  );
}

/** All identity tokens a destination link could be matched by. */
export function linkIdentityCandidates(link: LoomLink): Set<string> {
  return new Set(
    [
      link.id,
      link.path,
      link.canonicalUri,
      link.targetObjectId,
      link.sourceResponseId,
      link.sourceCanonicalUri,
      responseIdFromReferenceAddress(link.path),
      responseIdFromReferenceAddress(link.canonicalUri),
      responseIdFromReferenceAddress(link.sourceCanonicalUri),
      link.meta?.id,
      link.meta?.canonicalUri,
      responseIdFromReferenceAddress(link.meta?.canonicalUri),
    ].filter((v): v is string => Boolean(v))
  );
}

// ── Type-level identity guard ─────────────────────────────────────────────────

/** Returns true when the destination type is "response". */
export function destinationIsResponse(destination: LoomLink): boolean {
  return destination.type === "response";
}

/** Returns true when the bookmark represents a response (not a loom/weft). */
export function bookmarkIsResponse(bookmark: BookmarkItem): boolean {
  return bookmark.type === "response";
}

/**
 * Returns true if the bookmark and destination share the same identity class.
 *
 * Response bookmarks only match response destinations.
 * Loom/conversation/weft bookmarks only match non-response destinations.
 *
 * This prevents the topbar "Address bookmarked" state from lighting up when
 * only a response from that loom is bookmarked, and vice versa.
 */
export function bookmarkMatchesDestinationType(
  bookmark: BookmarkItem,
  destination: LoomLink
): boolean {
  return bookmarkIsResponse(bookmark) === destinationIsResponse(destination);
}

// ── Response-level match ──────────────────────────────────────────────────────

/**
 * Returns true when a bookmark identifies the given response.
 *
 * Priority order (most to least stable):
 *   1. Direct targetObjectId equality (stable raw UUID)
 *   2. Candidate-set overlap (covers address, meta.id, serviceUserResponseId, URL ?id= param)
 *
 * Display codes are never used.
 */
export function bookmarkMatchesResponseItem(
  bookmark: BookmarkItem,
  response: ResponseItem
): boolean {
  if (bookmark.type !== "response") return false;

  // Fast path: raw ID match — unaffected by path/code changes
  const tid = bookmark.targetObjectId;
  if (tid) {
    if (
      tid === response.id ||
      tid === response.serviceUserResponseId ||
      tid === response.meta?.id
    ) {
      return true;
    }
  }

  // Fallback: candidate-set overlap
  const bookmarkCandidates = bookmarkIdentityCandidates(bookmark);
  const responseCandidates = new Set<string>(
    [
      response.id,
      response.serviceUserResponseId,
      response.meta?.id,
      response.address,
      response.meta?.canonicalUri,
      responseIdFromReferenceAddress(response.address),
      responseIdFromReferenceAddress(response.meta?.canonicalUri),
    ].filter((v): v is string => Boolean(v))
  );
  return Array.from(bookmarkCandidates).some((c) => responseCandidates.has(c));
}

// ── Path-only match (canonical address equality) ──────────────────────────────

/**
 * Returns true when the bookmark's stored path exactly equals the destination
 * path.  Type guard is applied first.
 */
export function bookmarkPathMatchesDestination(
  bookmark: BookmarkItem,
  destination: LoomLink
): boolean {
  if (!bookmarkMatchesDestinationType(bookmark, destination)) return false;
  return Boolean(bookmark.path && bookmark.path === destination.path);
}

// ── Candidate-set match ───────────────────────────────────────────────────────

/**
 * Returns true when any of the bookmark's identity candidates overlap with
 * any of the destination's identity candidates.
 *
 * Type guard is applied first — response and non-response identities can never
 * cross-match via candidate overlap.
 */
export function bookmarkCandidatesMatchDestination(
  bookmark: BookmarkItem,
  destination: LoomLink
): boolean {
  if (!bookmarkMatchesDestinationType(bookmark, destination)) return false;
  const bCandidates = bookmarkIdentityCandidates(bookmark);
  const dCandidates = linkIdentityCandidates(destination);
  return Array.from(bCandidates).some((c) => dCandidates.has(c));
}
