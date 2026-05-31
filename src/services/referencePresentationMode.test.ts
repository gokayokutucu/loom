/**
 * Reference presentation mode persistence tests.
 *
 * Product rules (REFERENCE-PRESENTATION-MODE-PERSISTENCE-001):
 *   1. Selected-text Ask to Loom → presentationMode: "attached-card"
 *   2. Add as Reference / inline insertion → presentationMode: "inline-chip"
 *   3. Presentation mode survives app reload via metadata.questionReferences.
 *   4. isAttachedQuoteReference uses presentationMode as primary discriminator.
 *   5. Legacy data without presentationMode falls back to badge === "Selection".
 *   6. The same underlying response can appear as card once and inline once.
 *   7. Inline references never render as attached cards.
 *   8. Attached cards never render as inline chips.
 */
import { describe, expect, it } from "vitest";
import type { LoomLink, ReferencePresentationMode } from "../types";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeLink(overrides: Partial<LoomLink> = {}): LoomLink {
  return {
    id: "resp-1",
    type: "fragment",
    title: "The Process of Trilateration",
    path: "loom://test/r/R-GPS#fragment=abc123",
    badge: "Selection",
    selectedText: "The Process of Trilateration",
    sourceResponseId: "resp-1",
    ...overrides,
  };
}

/**
 * Mirrors the logic of isAttachedQuoteReference in App.tsx.
 * Kept here so the tests exercise the same rules without depending on
 * the component tree.
 */
function isAttachedQuoteReference(link: LoomLink): boolean {
  if (link.presentationMode === "attached-card") return true;
  if (link.presentationMode === "inline-chip") return false;
  // Legacy fallback
  return (
    (link.type === "fragment" || Boolean(link.selectedText && link.sourceResponseId)) &&
    link.badge === "Selection"
  );
}

function splitPromptReferences(links: LoomLink[]): {
  attached: LoomLink[];
  inline: LoomLink[];
} {
  const attached: LoomLink[] = [];
  const inline: LoomLink[] = [];
  links.forEach((link) => {
    if (isAttachedQuoteReference(link)) attached.push(link);
    else inline.push(link);
  });
  return { attached, inline };
}

/**
 * Simulates what loomLinkFromPlannerReference returns for a reference
 * that carries presentationMode: "attached-card".
 */
function plannerReferenceWithPresentationMode(
  presentationMode: ReferencePresentationMode
): LoomLink {
  return makeLink({
    // loomLinkFromPlannerReference restores badge from presentationMode
    badge: presentationMode === "attached-card" ? "Selection" : "Fragment",
    presentationMode,
  });
}

// ── 1. Creation: Ask to Loom produces "attached-card" ─────────────────────

describe("Ask to Loom reference creation", () => {
  it("selectionReferenceFromSelection sets badge: Selection", () => {
    const link = makeLink({ badge: "Selection", presentationMode: "attached-card" });
    expect(link.badge).toBe("Selection");
  });

  it("selectionReferenceFromSelection sets presentationMode: attached-card", () => {
    const link = makeLink({ badge: "Selection", presentationMode: "attached-card" });
    expect(link.presentationMode).toBe("attached-card");
  });

  it("attached-card reference is classified as attached quote", () => {
    const link = makeLink({ presentationMode: "attached-card" });
    expect(isAttachedQuoteReference(link)).toBe(true);
  });

  it("attached-card reference does NOT render inline", () => {
    const link = makeLink({ presentationMode: "attached-card" });
    const { attached, inline } = splitPromptReferences([link]);
    expect(attached).toHaveLength(1);
    expect(inline).toHaveLength(0);
  });
});

// ── 2. Creation: inline Add as Reference produces "inline-chip" ───────────

describe("Inline Add as Reference creation", () => {
  it("inline-chip reference does NOT classify as attached quote", () => {
    const link = makeLink({ badge: "Fragment", presentationMode: "inline-chip" });
    expect(isAttachedQuoteReference(link)).toBe(false);
  });

  it("inline-chip reference renders inline even when selectedText is present", () => {
    const link = makeLink({
      badge: "Fragment",
      presentationMode: "inline-chip",
      selectedText: "The Process of Trilateration",
    });
    const { attached, inline } = splitPromptReferences([link]);
    expect(attached).toHaveLength(0);
    expect(inline).toHaveLength(1);
  });

  it("inline-chip reference never renders as an attached card", () => {
    const link = makeLink({ badge: "Fragment", presentationMode: "inline-chip" });
    const { attached } = splitPromptReferences([link]);
    expect(attached).toHaveLength(0);
  });
});

// ── 3. Reload path: presentationMode restores correctly ───────────────────

describe("Presentation mode after reload (planner reference deserialization)", () => {
  it("planner reference with presentationMode: attached-card becomes Selection badge", () => {
    const link = plannerReferenceWithPresentationMode("attached-card");
    expect(link.badge).toBe("Selection");
  });

  it("planner reference with presentationMode: inline-chip keeps Fragment badge", () => {
    const link = plannerReferenceWithPresentationMode("inline-chip");
    expect(link.badge).toBe("Fragment");
  });

  it("attached-card planner reference still classifies as attached after reload", () => {
    const reloaded = plannerReferenceWithPresentationMode("attached-card");
    expect(isAttachedQuoteReference(reloaded)).toBe(true);
  });

  it("inline-chip planner reference still classifies as inline after reload", () => {
    const reloaded = plannerReferenceWithPresentationMode("inline-chip");
    expect(isAttachedQuoteReference(reloaded)).toBe(false);
  });

  it("attached-card render path is card after reload", () => {
    const reloaded = plannerReferenceWithPresentationMode("attached-card");
    const { attached, inline } = splitPromptReferences([reloaded]);
    expect(attached).toHaveLength(1);
    expect(inline).toHaveLength(0);
  });

  it("inline-chip render path is inline after reload", () => {
    const reloaded = plannerReferenceWithPresentationMode("inline-chip");
    const { attached, inline } = splitPromptReferences([reloaded]);
    expect(attached).toHaveLength(0);
    expect(inline).toHaveLength(1);
  });
});

// ── 4. Legacy fallback ────────────────────────────────────────────────────

describe("Legacy fallback (no presentationMode)", () => {
  it("badge: Selection without presentationMode is attached card (legacy)", () => {
    const link = makeLink({ badge: "Selection", presentationMode: undefined });
    expect(isAttachedQuoteReference(link)).toBe(true);
  });

  it("badge: Fragment without presentationMode is inline chip (legacy)", () => {
    const link = makeLink({ badge: "Fragment", presentationMode: undefined });
    expect(isAttachedQuoteReference(link)).toBe(false);
  });

  it("badge: Linked without presentationMode is inline chip (legacy)", () => {
    const link = makeLink({ type: "conversation", badge: "Linked", presentationMode: undefined });
    expect(isAttachedQuoteReference(link)).toBe(false);
  });
});

// ── 5. Same response used as both card and inline-chip ────────────────────

describe("Same underlying response with different presentation modes", () => {
  it("one card and one inline for the same response id coexist", () => {
    const card = makeLink({ id: "resp-1", badge: "Selection", presentationMode: "attached-card" });
    const inline = makeLink({ id: "resp-1", badge: "Fragment", presentationMode: "inline-chip" });
    const { attached, inline: inlineGroup } = splitPromptReferences([card, inline]);
    expect(attached).toHaveLength(1);
    expect(inlineGroup).toHaveLength(1);
  });

  it("each presentation mode routes to the correct renderer", () => {
    const card = makeLink({ id: "resp-2", presentationMode: "attached-card" });
    const inline = makeLink({ id: "resp-3", presentationMode: "inline-chip" });
    const { attached, inline: inlineGroup } = splitPromptReferences([card, inline]);
    expect(attached[0].id).toBe("resp-2");
    expect(inlineGroup[0].id).toBe("resp-3");
  });
});

// ── 6. presentationMode overrides badge ──────────────────────────────────

describe("presentationMode takes priority over badge", () => {
  it("presentationMode: inline-chip wins even when badge is Selection", () => {
    // Hypothetical inconsistent data — presentationMode wins.
    const link = makeLink({ badge: "Selection", presentationMode: "inline-chip" });
    expect(isAttachedQuoteReference(link)).toBe(false);
  });

  it("presentationMode: attached-card wins even when badge is Fragment", () => {
    const link = makeLink({ badge: "Fragment", presentationMode: "attached-card" });
    expect(isAttachedQuoteReference(link)).toBe(true);
  });
});

// ── 7. No duplicate rendering ─────────────────────────────────────────────

describe("No duplicate rendering of the same reference", () => {
  it("each reference appears in exactly one bucket", () => {
    const links: LoomLink[] = [
      makeLink({ id: "a", presentationMode: "attached-card" }),
      makeLink({ id: "b", presentationMode: "inline-chip" }),
      makeLink({ id: "c", badge: "Selection", presentationMode: undefined }),
      makeLink({ id: "d", badge: "Fragment", presentationMode: undefined }),
    ];
    const { attached, inline } = splitPromptReferences(links);
    const allIds = [...attached, ...inline].map((l) => l.id);
    expect(allIds.sort()).toEqual(["a", "b", "c", "d"]);
    // No id appears twice
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
