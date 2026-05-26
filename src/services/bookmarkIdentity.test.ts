/**
 * Tests for bookmark identity model.
 *
 * Core rules under test:
 *  - Identity keys are canonical target tuples (never display codes)
 *  - loom key ≠ response key for the same loom
 *  - Response matching uses raw responseId, not display codes like R-00000
 *  - URL ?id= extraction fixes stale R-00000 paths
 *  - Type guard prevents response ↔ loom cross-matching
 */
import { describe, expect, it } from "vitest";
import type { BookmarkItem, LoomLink, ResponseItem } from "../types";
import {
  bookmarkCandidatesMatchDestination,
  bookmarkIdentityCandidates,
  bookmarkMatchesDestinationType,
  bookmarkMatchesResponseItem,
  bookmarkTargetKey,
  destinationTargetKey,
  linkIdentityCandidates,
  responseTargetKey,
} from "./bookmarkIdentity";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponseBookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: "bm-001",
    type: "response",
    title: "Test response",
    editableTitle: "Test response",
    path: "loom://my-loom/L-ETDN8F/r/R-00000?id=resp-uuid-001",
    lastUsed: "",
    targetObjectId: "resp-uuid-001",
    ...overrides,
  };
}

function makeLoomBookmark(overrides: Partial<BookmarkItem> = {}): BookmarkItem {
  return {
    id: "bm-002",
    type: "conversation",
    title: "My loom",
    editableTitle: "My loom",
    path: "loom://my-loom/L-ETDN8F",
    lastUsed: "",
    targetObjectId: "loom-uuid-abc",
    ...overrides,
  };
}

function makeResponseItem(overrides: Partial<ResponseItem> = {}): ResponseItem {
  return {
    id: "resp-uuid-001",
    question: "What does GPS stand for?",
    title: "What does GPS stand for?",
    answer: [],
    address: "loom://my-loom/L-ETDN8F/r/R-GEK3A3?id=resp-uuid-001",
    suggestedLinks: [],
    bookmarkedLinks: [],
    ...overrides,
  } as ResponseItem;
}

function makeResponseDestination(overrides: Partial<LoomLink> = {}): LoomLink {
  return {
    id: "resp-uuid-001",
    type: "response",
    title: "What does GPS stand for?",
    path: "loom://my-loom/L-ETDN8F/r/R-GEK3A3?id=resp-uuid-001",
    ...overrides,
  };
}

function makeLoomDestination(overrides: Partial<LoomLink> = {}): LoomLink {
  return {
    id: "loom-uuid-abc",
    type: "conversation",
    title: "My loom",
    path: "loom://my-loom/L-ETDN8F",
    ...overrides,
  };
}

// ── bookmarkTargetKey ─────────────────────────────────────────────────────────

describe("bookmarkTargetKey", () => {
  it("returns a 'response:' prefix for response bookmarks", () => {
    expect(bookmarkTargetKey(makeResponseBookmark())).toMatch(/^response:/);
  });

  it("returns a 'loom:' prefix for loom/conversation bookmarks", () => {
    expect(bookmarkTargetKey(makeLoomBookmark())).toMatch(/^loom:/);
  });

  it("loom bookmark key NEVER equals response bookmark key for the same loom", () => {
    // A bookmark for the loom itself and a bookmark for one of its responses
    // must have different keys.
    const loomBm = makeLoomBookmark({ targetObjectId: "loom-uuid-abc" });
    const respBm = makeResponseBookmark({ targetObjectId: "resp-uuid-001" });
    expect(bookmarkTargetKey(loomBm)).not.toBe(bookmarkTargetKey(respBm));
  });

  it("uses targetObjectId over path-derived ID", () => {
    const bm = makeResponseBookmark({ targetObjectId: "stable-id" });
    expect(bookmarkTargetKey(bm)).toBe("response:stable-id");
  });

  it("falls back to URL ?id= param when no targetObjectId", () => {
    const bm = makeResponseBookmark({
      targetObjectId: undefined,
      path: "loom://my-loom/r/R-00000?id=extracted-id",
    });
    expect(bookmarkTargetKey(bm)).toBe("response:extracted-id");
  });
});

// ── destinationTargetKey ──────────────────────────────────────────────────────

describe("destinationTargetKey", () => {
  it("returns 'response:' prefix for response destinations", () => {
    expect(destinationTargetKey(makeResponseDestination())).toMatch(/^response:/);
  });

  it("returns 'loom:' prefix for loom/conversation destinations", () => {
    expect(destinationTargetKey(makeLoomDestination())).toMatch(/^loom:/);
  });

  it("response destination key matches response bookmark key for same response", () => {
    const bm = makeResponseBookmark({ targetObjectId: "resp-uuid-001" });
    const dest = makeResponseDestination({ id: "resp-uuid-001" });
    expect(bookmarkTargetKey(bm)).toBe(destinationTargetKey(dest));
  });
});

// ── responseTargetKey ─────────────────────────────────────────────────────────

describe("responseTargetKey", () => {
  it("returns 'response:' prefix", () => {
    expect(responseTargetKey(makeResponseItem())).toMatch(/^response:/);
  });

  it("key does NOT contain display code (R-XXXXX)", () => {
    const key = responseTargetKey(makeResponseItem());
    expect(key).not.toContain("R-00000");
    expect(key).not.toContain("R-GEK3A3");
  });

  it("uses raw response UUID as the identity", () => {
    expect(responseTargetKey(makeResponseItem())).toBe("response:resp-uuid-001");
  });
});

// ── bookmarkIdentityCandidates URL extraction ─────────────────────────────────

describe("bookmarkIdentityCandidates — URL ?id= extraction", () => {
  it("includes the responseId extracted from path when path contains ?id=", () => {
    const bm = makeResponseBookmark({
      path: "loom://my-loom/r/R-00000?id=uuid-from-url",
      targetObjectId: undefined,
    });
    const candidates = bookmarkIdentityCandidates(bm);
    expect(candidates.has("uuid-from-url")).toBe(true);
  });

  it("includes the responseId extracted from canonicalUri", () => {
    const bm = makeResponseBookmark({
      path: undefined as unknown as string,
      canonicalUri: "loom://my-loom/r/R-WMKM2N?id=uuid-canon",
      targetObjectId: undefined,
    });
    const candidates = bookmarkIdentityCandidates(bm);
    expect(candidates.has("uuid-canon")).toBe(true);
  });

  it("includes the raw display code path itself (for exact path match)", () => {
    const path = "loom://my-loom/r/R-WMKM2N?id=uuid-abc";
    const bm = makeResponseBookmark({ path });
    const candidates = bookmarkIdentityCandidates(bm);
    expect(candidates.has(path)).toBe(true);
  });

  it("candidate sets are symmetric with linkIdentityCandidates for same ?id=", () => {
    const uuid = "shared-uuid-xyz";
    const bm = makeResponseBookmark({
      path: `loom://loom/r/R-00000?id=${uuid}`,
      targetObjectId: undefined,
    });
    const link = makeResponseDestination({
      path: `loom://loom/r/R-UPDATED?id=${uuid}`,
      id: uuid,
    });
    const bmCandidates = bookmarkIdentityCandidates(bm);
    const lnCandidates = linkIdentityCandidates(link);
    const overlap = Array.from(bmCandidates).some((c) => lnCandidates.has(c));
    expect(overlap).toBe(true);
  });
});

// ── bookmarkMatchesResponseItem ───────────────────────────────────────────────

describe("bookmarkMatchesResponseItem", () => {
  it("matches when targetObjectId equals response.id", () => {
    const bm = makeResponseBookmark({ targetObjectId: "resp-uuid-001" });
    const resp = makeResponseItem({ id: "resp-uuid-001" });
    expect(bookmarkMatchesResponseItem(bm, resp)).toBe(true);
  });

  it("does NOT match when targetObjectId differs and no other overlap", () => {
    // Path must also not contain the response's UUID — otherwise URL extraction
    // would pull resp-uuid-001 into the candidate set and cause a false match.
    const bm = makeResponseBookmark({
      targetObjectId: "different-id",
      path: "loom://my-loom/L-ETDN8F/r/R-00000?id=different-id",
    });
    const resp = makeResponseItem({ id: "resp-uuid-001" });
    expect(bookmarkMatchesResponseItem(bm, resp)).toBe(false);
  });

  it("matches via URL ?id= extraction even when path has stale R-00000 code", () => {
    // Bookmark was created before response got a display code
    const bm = makeResponseBookmark({
      targetObjectId: undefined,
      path: "loom://my-loom/L-ETDN8F/r/R-00000?id=resp-uuid-001",
    });
    // Response now has its proper display code in the address
    const resp = makeResponseItem({
      id: "resp-uuid-001",
      address: "loom://my-loom/L-ETDN8F/r/R-GEK3A3?id=resp-uuid-001",
    });
    expect(bookmarkMatchesResponseItem(bm, resp)).toBe(true);
  });

  it("never matches a non-response bookmark", () => {
    const loomBm = makeLoomBookmark();
    const resp = makeResponseItem();
    expect(bookmarkMatchesResponseItem(loomBm, resp)).toBe(false);
  });

  it("matching never uses display codes — only raw IDs", () => {
    // Bookmark path has one display code, response address has a different one
    // but the same raw UUID in ?id= — must still match
    const bm = makeResponseBookmark({
      targetObjectId: undefined,
      path: "loom://loom/r/R-00000?id=resp-uuid-001",
    });
    const resp = makeResponseItem({
      id: "resp-uuid-001",
      address: "loom://loom/r/R-WMKM2N?id=resp-uuid-001",
    });
    expect(bookmarkMatchesResponseItem(bm, resp)).toBe(true);
  });
});

// ── bookmarkMatchesDestinationType (type guard) ───────────────────────────────

describe("bookmarkMatchesDestinationType", () => {
  it("response bookmark matches only response destinations", () => {
    const bm = makeResponseBookmark();
    expect(bookmarkMatchesDestinationType(bm, makeResponseDestination())).toBe(true);
    expect(bookmarkMatchesDestinationType(bm, makeLoomDestination())).toBe(false);
  });

  it("loom bookmark matches only loom/conversation destinations", () => {
    const bm = makeLoomBookmark();
    expect(bookmarkMatchesDestinationType(bm, makeLoomDestination())).toBe(true);
    expect(bookmarkMatchesDestinationType(bm, makeResponseDestination())).toBe(false);
  });

  it("loom bookmark and response footer can coexist for same loom — they never cross-match", () => {
    const loomBm = makeLoomBookmark({ targetObjectId: "loom-uuid-abc" });
    const respDest = makeResponseDestination({ id: "resp-uuid-001" });
    // Removing loom bookmark must not affect response destination
    expect(bookmarkMatchesDestinationType(loomBm, respDest)).toBe(false);
  });
});

// ── bookmarkCandidatesMatchDestination — topbar isolation ─────────────────────

describe("bookmarkCandidatesMatchDestination — topbar isolation", () => {
  it("topbar shows bookmarked when current loom address is bookmarked (loom type)", () => {
    const bm = makeLoomBookmark({ path: "loom://my-loom/L-ETDN8F", targetObjectId: "loom-uuid-abc" });
    const dest = makeLoomDestination({ path: "loom://my-loom/L-ETDN8F", id: "loom-uuid-abc" });
    expect(bookmarkCandidatesMatchDestination(bm, dest)).toBe(true);
  });

  it("topbar does NOT show bookmarked when only a response from that loom is bookmarked", () => {
    // A response bookmark should NOT activate the topbar when viewing the loom address
    const respBm = makeResponseBookmark({ targetObjectId: "resp-uuid-001" });
    const loomDest = makeLoomDestination({ path: "loom://my-loom/L-ETDN8F" });
    expect(bookmarkCandidatesMatchDestination(respBm, loomDest)).toBe(false);
  });

  it("response footer shows bookmarked when that response is bookmarked", () => {
    const bm = makeResponseBookmark({
      targetObjectId: "resp-uuid-001",
      path: "loom://my-loom/L-ETDN8F/r/R-GEK3A3?id=resp-uuid-001",
    });
    const dest = makeResponseDestination({
      id: "resp-uuid-001",
      path: "loom://my-loom/L-ETDN8F/r/R-GEK3A3?id=resp-uuid-001",
    });
    expect(bookmarkCandidatesMatchDestination(bm, dest)).toBe(true);
  });

  it("response footer does NOT show bookmarked when a different response is bookmarked", () => {
    // Path must also reference the other response's UUID so it doesn't bleed
    // into candidates for resp-uuid-001.
    const bm = makeResponseBookmark({
      targetObjectId: "resp-uuid-OTHER",
      path: "loom://my-loom/L-ETDN8F/r/R-00000?id=resp-uuid-OTHER",
    });
    const dest = makeResponseDestination({ id: "resp-uuid-001" });
    expect(bookmarkCandidatesMatchDestination(bm, dest)).toBe(false);
  });
});
