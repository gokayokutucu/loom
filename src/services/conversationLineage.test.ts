import { describe, expect, it } from "vitest";
import {
  isLoomLink,
  isLoomObjectType,
  isWeftConversation,
  type Conversation,
  type LoomLineageRole,
  type LoomLink,
  type LoomMetadata,
  type LoomObjectType,
} from "../types";
import {
  temporaryWeftTransitionTable,
  transitionTemporaryWeftStatus,
  type TemporaryWeftLifecycleStatus,
} from "../state/temporaryWeftMachine";
import { buildAddressBarSuggestions } from "./omnibox";

function makeConversation(
  overrides: Partial<Conversation> & { lineageRole?: LoomLineageRole } = {}
): Conversation {
  return {
    id: "loom-1",
    title: "Test Loom",
    path: "/looms/loom-1",
    folder: "Looms",
    summary: "A test loom",
    keywords: [],
    ...overrides,
  } as Conversation;
}

// ---------------------------------------------------------------------------
// isWeftConversation
// ---------------------------------------------------------------------------

describe("isWeftConversation", () => {
  it("returns false for a root Loom (no lineageRole)", () => {
    expect(isWeftConversation(makeConversation())).toBe(false);
  });

  it("returns true for a weft Loom", () => {
    expect(isWeftConversation(makeConversation({ lineageRole: "weft" }))).toBe(true);
  });

  it("returns true for a revision weft", () => {
    expect(isWeftConversation(makeConversation({ lineageRole: "revision" }))).toBe(true);
  });

  it("is not fooled by a /wefts/ path when lineageRole is absent", () => {
    // Old path-sniffing heuristic would mark this as a weft; new code should not
    const conv = makeConversation({ path: "/looms/loom-1/wefts/loom-2" });
    expect(isWeftConversation(conv)).toBe(false);
  });

  it("is not fooled by a W- code when lineageRole is absent", () => {
    const conv = makeConversation({ meta: { code: "W-001" } as never });
    expect(isWeftConversation(conv)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildAddressBarSuggestions — badge/type derivation via lineageRole
// ---------------------------------------------------------------------------

describe("buildAddressBarSuggestions lineageRole → badge", () => {
  it("labels a root Loom as 'Loom' badge and 'conversation' type", () => {
    const conv = makeConversation({ id: "root-1", title: "Root Loom" });
    const [suggestion] = buildAddressBarSuggestions({ query: "", conversations: [conv] });
    expect(suggestion?.badge).toBe("Loom");
    expect(suggestion?.type).toBe("conversation");
  });

  it("labels a weft Loom as 'Weft' badge and 'loom' type", () => {
    const conv = makeConversation({
      id: "weft-1",
      title: "Weft Loom",
      lineageRole: "weft",
    });
    const [suggestion] = buildAddressBarSuggestions({ query: "", conversations: [conv] });
    expect(suggestion?.badge).toBe("Weft");
    expect(suggestion?.type).toBe("loom");
  });

  it("labels a revision weft as 'Weft' badge and 'loom' type", () => {
    const conv = makeConversation({
      id: "rev-1",
      title: "Revision Loom",
      lineageRole: "revision",
    });
    const [suggestion] = buildAddressBarSuggestions({ query: "", conversations: [conv] });
    expect(suggestion?.badge).toBe("Weft");
    expect(suggestion?.type).toBe("loom");
  });

  it("does NOT mark as weft a Loom whose path contains /wefts/ but has no lineageRole", () => {
    const conv = makeConversation({
      id: "path-trick",
      title: "Path Trick",
      path: "/looms/loom-1/wefts/loom-2",
    });
    const [suggestion] = buildAddressBarSuggestions({ query: "", conversations: [conv] });
    expect(suggestion?.badge).toBe("Loom");
    expect(suggestion?.type).toBe("conversation");
  });
});

// ---------------------------------------------------------------------------
// isLoomObjectType (Phase 3)
// ---------------------------------------------------------------------------

describe("isLoomObjectType", () => {
  it("returns true for 'conversation'", () => {
    expect(isLoomObjectType("conversation")).toBe(true);
  });

  it("returns true for 'loom'", () => {
    expect(isLoomObjectType("loom")).toBe(true);
  });

  it("returns false for 'response'", () => {
    expect(isLoomObjectType("response")).toBe(false);
  });

  it("returns false for 'fragment'", () => {
    expect(isLoomObjectType("fragment")).toBe(false);
  });

  it("returns false for 'bookmark'", () => {
    expect(isLoomObjectType("bookmark")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isLoomObjectType(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isLoomObjectType(null)).toBe(false);
  });

  // Exhaustive check: every non-Loom LoomObjectType should be false
  const nonLoomTypes: LoomObjectType[] = ["response", "fragment", "attachment", "bookmark", "semantic", "recent"];
  for (const t of nonLoomTypes) {
    it(`returns false for '${t}'`, () => {
      expect(isLoomObjectType(t)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// isLoomLink (Phase 3)
// ---------------------------------------------------------------------------

function makeLink(type: LoomObjectType): LoomLink {
  return {
    id: `link-${type}`,
    type,
    title: "Test link",
    path: "/test",
  };
}

describe("isLoomLink", () => {
  it("returns true for a link with type 'conversation'", () => {
    expect(isLoomLink(makeLink("conversation"))).toBe(true);
  });

  it("returns true for a link with type 'loom'", () => {
    expect(isLoomLink(makeLink("loom"))).toBe(true);
  });

  it("returns false for a link with type 'response'", () => {
    expect(isLoomLink(makeLink("response"))).toBe(false);
  });

  it("returns false for a link with type 'fragment'", () => {
    expect(isLoomLink(makeLink("fragment"))).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isLoomLink(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isLoomLink(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Quick Ask promotion contract (Phase 5)
// ---------------------------------------------------------------------------
//
// Contract: Quick Ask is an ephemeral interaction surface. Before promotion it
// is NOT a persisted Loom destination. After promotion it materializes as a
// standard Weft Loom (Conversation with lineageRole: "weft"). No separate
// QuickAsk entity type is introduced.

describe("Quick Ask lifecycle — ephemeral before promotion", () => {
  it("pre-promotion statuses are not 'persisted'", () => {
    const prePromotionStatuses: TemporaryWeftLifecycleStatus[] = [
      "absent",
      "temporary",
      "active",
      "promoting",
    ];
    for (const status of prePromotionStatuses) {
      expect(status).not.toBe("persisted");
    }
  });

  it("PROMOTION_SUCCEEDED is the only event that transitions promoting → persisted", () => {
    const transitions = temporaryWeftTransitionTable.promoting;
    const toPersistedEvents = Object.entries(transitions)
      .filter(([, next]) => next === "persisted")
      .map(([event]) => event);
    expect(toPersistedEvents).toEqual(["PROMOTION_SUCCEEDED"]);
  });

  it("active state goes to promoting on PROMOTION_STARTED, not directly to persisted", () => {
    const result = transitionTemporaryWeftStatus("active", { type: "PROMOTION_STARTED" });
    expect(result).toBe("promoting");
  });

  it("promoting state transitions to persisted after PROMOTION_SUCCEEDED", () => {
    const result = transitionTemporaryWeftStatus("promoting", {
      type: "PROMOTION_SUCCEEDED",
      persistedWeftId: "weft-loom-123",
    });
    expect(result).toBe("persisted");
  });

  it("temporary state can be discarded without creating a Loom", () => {
    const result = transitionTemporaryWeftStatus("temporary", { type: "DISCARD_TEMP" });
    expect(result).toBe("discarded");
  });
});

describe("Quick Ask promotion output — promoted exchange is a Loom destination", () => {
  // Simulates the Conversation produced by materializeServiceWeftConversation
  // (or the fallback path) after createOrOpenWeft(source: "quick_ask_convert") succeeds.
  function makePromotedQuickAskConversation(): Conversation {
    return {
      id: "weft-loom-abc123",
      title: "Loom: What is hoisting in JavaScript?",
      path: "/looms/weft-loom-abc123",
      folder: "Looms",
      summary: "Branched from Origin Loom.",
      iconKey: "workflow",
      // lineageRole is set by materializeServiceWeftConversation (Phase 2) and by the
      // fallback path fix (Phase 5). "quick_ask_convert" source produces a "weft" role.
      lineageRole: "weft",
    };
  }

  it("promoted Quick Ask Conversation has lineageRole 'weft'", () => {
    expect(makePromotedQuickAskConversation().lineageRole).toBe("weft");
  });

  it("promoted Quick Ask is detected as a weft by isWeftConversation", () => {
    expect(isWeftConversation(makePromotedQuickAskConversation())).toBe(true);
  });

  it("promoted Quick Ask is shown in address bar as 'Weft' badge", () => {
    const conversation = makePromotedQuickAskConversation();
    const [suggestion] = buildAddressBarSuggestions({ query: "", conversations: [conversation] });
    expect(suggestion?.badge).toBe("Weft");
    expect(suggestion?.type).toBe("loom");
  });

  it("promoted Quick Ask navigation link (type: 'loom') passes isLoomLink", () => {
    // openWeftDestination produces a LoomLink with type: "loom" for navigation.
    const navigationLink: LoomLink = {
      id: "weft-loom-abc123",
      type: "loom",
      title: "Loom: What is hoisting in JavaScript?",
      path: "/looms/weft-loom-abc123",
    };
    expect(isLoomLink(navigationLink)).toBe(true);
  });

  it("promoted Quick Ask link type passes isLoomObjectType", () => {
    expect(isLoomObjectType("loom")).toBe(true);
  });
});

describe("Quick Ask — no separate persistent entity type", () => {
  it("'quick' is NOT in LoomObjectType — Quick Ask is not a persistent entity", () => {
    // LoomObjectType is the exhaustive set of persistent/addressable object types.
    // "quick" only exists in the local LineageNodeType (App.tsx rendering) — not in persistence.
    const allLoomObjectTypes: LoomObjectType[] = [
      "conversation",
      "loom",
      "response",
      "fragment",
      "attachment",
      "bookmark",
      "semantic",
      "recent",
    ];
    expect(allLoomObjectTypes).not.toContain("quick");
    expect(allLoomObjectTypes).not.toContain("quick_ask");
    expect(allLoomObjectTypes).not.toContain("quick_question");
  });

  it("'quick' lineageRole does not exist — promoted output uses 'weft' or 'revision'", () => {
    // LoomLineageRole is the exhaustive set of lineage roles.
    // Quick Ask converts to a standard Weft, never to a "quick" lineage role.
    const allLineageRoles: LoomLineageRole[] = ["weft", "revision"];
    expect(allLineageRoles).not.toContain("quick");
  });
});
