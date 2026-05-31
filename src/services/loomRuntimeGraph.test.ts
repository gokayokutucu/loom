/**
 * Tests for the runtime graph localStorage schema version guard.
 *
 * Core rules under test:
 *  - State without schemaVersion (pre-v2 / legacy) is rejected.
 *  - State with schemaVersion < RUNTIME_GRAPH_SCHEMA_VERSION is rejected.
 *  - State with schemaVersion === RUNTIME_GRAPH_SCHEMA_VERSION is accepted.
 *  - State with a future schemaVersion > current is accepted (forward-compatible).
 *  - null / undefined / non-object payloads are rejected.
 *
 * These tests cover the "stale BMK graph alias does not keep bookmark state alive"
 * requirement: old sessions wrote data with no schemaVersion; the guard discards
 * it so orphaned BMK objects cannot bleed into new sessions.
 */
import { describe, expect, it } from "vitest";
import {
  isRuntimeStateCompatible,
  RUNTIME_GRAPH_SCHEMA_VERSION,
} from "./loomRuntimeGraph";

// ── RUNTIME_GRAPH_SCHEMA_VERSION sanity ───────────────────────────────────────

describe("RUNTIME_GRAPH_SCHEMA_VERSION", () => {
  it("is a positive integer", () => {
    expect(typeof RUNTIME_GRAPH_SCHEMA_VERSION).toBe("number");
    expect(Number.isInteger(RUNTIME_GRAPH_SCHEMA_VERSION)).toBe(true);
    expect(RUNTIME_GRAPH_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it("is at least 2 — the first authority-boundary-aware version", () => {
    expect(RUNTIME_GRAPH_SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });
});

// ── isRuntimeStateCompatible ──────────────────────────────────────────────────

describe("isRuntimeStateCompatible", () => {
  it("rejects null", () => {
    expect(isRuntimeStateCompatible(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isRuntimeStateCompatible(undefined)).toBe(false);
  });

  it("rejects a non-object primitive (string)", () => {
    expect(isRuntimeStateCompatible("legacy" as never)).toBe(false);
  });

  it("rejects state with no schemaVersion field (legacy pre-v2 data)", () => {
    // Simulates a payload written before the authority-boundary schema bump.
    // These may contain stale BMK/QQ aliases from pseudo-artifact sessions.
    expect(isRuntimeStateCompatible({ objects: [], aliases: [], edges: [] })).toBe(false);
  });

  it("rejects state with schemaVersion explicitly set to 1", () => {
    expect(isRuntimeStateCompatible({ schemaVersion: 1 })).toBe(false);
  });

  it("rejects state with schemaVersion 0", () => {
    expect(isRuntimeStateCompatible({ schemaVersion: 0 })).toBe(false);
  });

  it("rejects state with schemaVersion one below current", () => {
    expect(
      isRuntimeStateCompatible({ schemaVersion: RUNTIME_GRAPH_SCHEMA_VERSION - 1 })
    ).toBe(false);
  });

  it("accepts state with the current schemaVersion", () => {
    expect(
      isRuntimeStateCompatible({ schemaVersion: RUNTIME_GRAPH_SCHEMA_VERSION })
    ).toBe(true);
  });

  it("accepts state with a future schemaVersion (forward-compatible)", () => {
    expect(
      isRuntimeStateCompatible({ schemaVersion: RUNTIME_GRAPH_SCHEMA_VERSION + 1 })
    ).toBe(true);
  });

  it("accepts state with schemaVersion and populated graph arrays", () => {
    expect(
      isRuntimeStateCompatible({
        schemaVersion: RUNTIME_GRAPH_SCHEMA_VERSION,
        objects: [],
        aliases: [],
        edges: [],
        ledgerEvents: [],
        referenceMentions: [],
        revisions: [],
      })
    ).toBe(true);
  });

  // ── Stale BMK alias isolation ──────────────────────────────────────────────
  //
  // Before v2, bookmark promotions wrote BMK_-prefixed objects and their alias
  // URIs into the runtime graph.  If a response was later deleted or replaced,
  // those BMK objects would remain in localStorage, causing the bookmark chip to
  // appear green for unrelated responses that happened to resolve to the same
  // alias URI.  The schema version guard prevents this by discarding the entire
  // pre-v2 payload on read.

  it("stale pre-v2 payload with BMK alias is rejected — stale bookmark state cannot leak", () => {
    const stalePrev2Payload = {
      // No schemaVersion — written before the authority-boundary bump
      objects: [
        {
          objectId: "BMK_old-bookmark",
          kind: "bookmark",
          status: "active",
          title: "Old Response",
          canonicalUri: "loom://objects/BMK_old-bookmark",
          aliasUri: "loom://my-loom/r/R-DELETED?id=old-response-uuid",
        },
      ],
      aliases: [
        {
          aliasUri: "loom://my-loom/r/R-DELETED?id=old-response-uuid",
          targetObjectId: "BMK_old-bookmark",
          isActive: true,
        },
      ],
      edges: [],
      ledgerEvents: [],
    };

    expect(isRuntimeStateCompatible(stalePrev2Payload as never)).toBe(false);
  });

  it("current-version payload with BMK alias is accepted", () => {
    const currentPayload = {
      schemaVersion: RUNTIME_GRAPH_SCHEMA_VERSION,
      objects: [
        {
          objectId: "BMK_current-bookmark",
          kind: "bookmark",
          status: "active",
          title: "Current Response",
          canonicalUri: "loom://objects/BMK_current-bookmark",
          aliasUri: "loom://my-loom/r/R-VALID?id=current-response-uuid",
        },
      ],
      aliases: [
        {
          aliasUri: "loom://my-loom/r/R-VALID?id=current-response-uuid",
          targetObjectId: "BMK_current-bookmark",
          isActive: true,
        },
      ],
      edges: [],
      ledgerEvents: [],
    };

    expect(isRuntimeStateCompatible(currentPayload as never)).toBe(true);
  });
});
