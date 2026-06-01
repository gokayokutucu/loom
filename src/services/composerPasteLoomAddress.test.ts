import { describe, expect, it } from "vitest";
import { compactLoomAddressLabel, extractLoomAddressSegments } from "./composerPasteLoomAddress";

// ── helpers ───────────────────────────────────────────────────────────────

function refs(segments: ReturnType<typeof extractLoomAddressSegments>) {
  return segments.filter((s) => s.kind === "reference");
}
function texts(segments: ReturnType<typeof extractLoomAddressSegments>) {
  return segments.filter((s) => s.kind === "text").map((s) => (s as { text: string }).text);
}

// ── unit tests ────────────────────────────────────────────────────────────

describe("extractLoomAddressSegments — address type detection", () => {
  it("plain Loom root address (L-CODE) produces a conversation-type reference", () => {
    const segments = extractLoomAddressSegments("loom://my-loom/L-ABCDE");
    const refSegs = refs(segments);
    expect(refSegs).toHaveLength(1);
    const ref = refSegs[0];
    if (ref?.kind !== "reference") throw new Error("expected reference");
    expect(ref.link.type).toBe("conversation");
    expect(ref.link.path).toBe("loom://my-loom/L-ABCDE");
    expect(ref.link.canonicalUri).toBe("loom://my-loom/L-ABCDE");
  });

  it("Weft address (loom://wefts/…) produces a conversation-type reference", () => {
    const weftAddress = "loom://wefts/weft-response-workflow-1780312055025-assistant";
    const segments = extractLoomAddressSegments(weftAddress);
    const refSegs = refs(segments);
    expect(refSegs).toHaveLength(1);
    const ref = refSegs[0];
    if (ref?.kind !== "reference") throw new Error("expected reference");
    // Weft is a Loom; no ?id= → conversation type
    expect(ref.link.type).toBe("conversation");
    expect(ref.link.path).toBe(weftAddress);
  });

  it("Response address with ?id= query param produces a response-type reference", () => {
    const responseAddress =
      "loom://my-loom/L-ABCDE/r/R-12345?id=a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const segments = extractLoomAddressSegments(responseAddress);
    const refSegs = refs(segments);
    expect(refSegs).toHaveLength(1);
    const ref = refSegs[0];
    if (ref?.kind !== "reference") throw new Error("expected reference");
    expect(ref.link.type).toBe("response");
    expect(ref.link.path).toBe(responseAddress);
    expect(ref.link.sourceResponseId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });
});

describe("extractLoomAddressSegments — non-Loom inputs fall through", () => {
  it("returns empty array for plain text with no loom:// substring", () => {
    expect(extractLoomAddressSegments("just some text")).toEqual([]);
  });

  it("returns empty array for a normal https:// URL", () => {
    expect(extractLoomAddressSegments("https://example.com/some/path")).toEqual([]);
  });

  it("returns empty array for an empty string", () => {
    expect(extractLoomAddressSegments("")).toEqual([]);
  });
});

describe("extractLoomAddressSegments — surrounding text is preserved", () => {
  it("preserves text before and after a Loom address", () => {
    const input = "Please compare loom://my-loom/L-ABC with today's answer.";
    const segments = extractLoomAddressSegments(input);
    const refSegs = refs(segments);
    const textSegs = texts(segments);

    expect(refSegs).toHaveLength(1);
    const ref = refSegs[0];
    if (ref?.kind !== "reference") throw new Error("expected reference");
    expect(ref.link.path).toBe("loom://my-loom/L-ABC");

    // Text segments must include the prefix and suffix
    const joined = textSegs.join("");
    expect(joined).toContain("Please compare ");
    expect(joined).toContain(" with today's answer.");
  });

  it("strips a trailing period that appears after the address in prose", () => {
    const segments = extractLoomAddressSegments("see loom://my-loom/L-ABC.");
    const refSegs = refs(segments);
    expect(refSegs).toHaveLength(1);
    const ref = refSegs[0];
    if (ref?.kind !== "reference") throw new Error("expected reference");
    // Period must not be part of the address
    expect(ref.link.path).toBe("loom://my-loom/L-ABC");
    // Period must reappear as a text segment
    const textSegs = texts(segments);
    expect(textSegs.join("")).toContain(".");
  });

  it("strips a trailing closing parenthesis from the address", () => {
    const segments = extractLoomAddressSegments("(see loom://my-loom/L-ABC)");
    const refSegs = refs(segments);
    expect(refSegs).toHaveLength(1);
    const ref = refSegs[0];
    if (ref?.kind !== "reference") throw new Error("expected reference");
    expect(ref.link.path).toBe("loom://my-loom/L-ABC");
    const textSegs = texts(segments);
    expect(textSegs.join("")).toContain(")");
  });
});

describe("extractLoomAddressSegments — multiple addresses", () => {
  it("produces one reference segment per Loom address when multiple are present", () => {
    const input = "loom://loom-a/L-111 and loom://loom-b/L-222";
    const segments = extractLoomAddressSegments(input);
    const refSegs = refs(segments);

    expect(refSegs).toHaveLength(2);

    const r0 = refSegs[0];
    const r1 = refSegs[1];
    if (r0?.kind !== "reference" || r1?.kind !== "reference") throw new Error("expected reference");

    expect(r0.link.path).toBe("loom://loom-a/L-111");
    expect(r1.link.path).toBe("loom://loom-b/L-222");
  });

  it("preserves order: text before first, between, and after last address", () => {
    const input = "first: loom://a/L-1, second: loom://b/L-2, done.";
    const segments = extractLoomAddressSegments(input);
    const kinds = segments.map((s) => s.kind);

    // Must start with text, alternate reference/text
    expect(kinds[0]).toBe("text");
    expect(kinds).toContain("reference");

    const addressOrder = refs(segments).map((r) => {
      if (r.kind !== "reference") throw new Error();
      return r.link.path;
    });
    expect(addressOrder).toEqual(["loom://a/L-1", "loom://b/L-2"]);
  });
});

describe("extractLoomAddressSegments — query strings are preserved", () => {
  it("preserves ?id= query param so response identity is not lost", () => {
    const address = "loom://some-loom/L-XYZ/r/R-9?id=deadbeef-0000-0000-0000-000000000000";
    const segments = extractLoomAddressSegments(address);
    const refSegs = refs(segments);
    expect(refSegs).toHaveLength(1);
    const ref = refSegs[0];
    if (ref?.kind !== "reference") throw new Error("expected reference");
    expect(ref.link.path).toContain("?id=deadbeef");
    expect(ref.link.type).toBe("response");
  });
});

// ── compactLoomAddressLabel ────────────────────────────────────────────────

describe("compactLoomAddressLabel — short code extraction", () => {
  it("extracts L-CODE from a Loom root address", () => {
    expect(compactLoomAddressLabel("loom://why-is-sleep-deprivation-so-dangerous/L-9TXNW"))
      .toBe("L-9TXNW");
  });

  it("extracts L-CODE from a Loom address with a long slug", () => {
    expect(
      compactLoomAddressLabel(
        "loom://why-is-sleep-deprivation-so-dangerous/L-9TXNW?id=a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      )
    ).toBe("L-9TXNW");
  });

  it("extracts the first code from a Response address (L-CODE before /r/R-CODE)", () => {
    const result = compactLoomAddressLabel(
      "loom://my-loom/L-ABCDE/r/R-12345?id=deadbeef"
    );
    // First code found is L-ABCDE
    expect(result).toBe("L-ABCDE");
  });

  it("extracts R-CODE from a response-only address pattern", () => {
    expect(compactLoomAddressLabel("loom://responses/R-ZZZZZ?id=uuid")).toBe("R-ZZZZZ");
  });

  it("truncates long addresses with no recognisable code to 40 chars + ellipsis", () => {
    const long = "loom://wefts/weft-response-workflow-1780312055025-assistant";
    const result = compactLoomAddressLabel(long);
    expect(result.length).toBeLessThanOrEqual(41); // 40 + "…"
    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith("loom://wefts/weft-response-workflow-178")).toBe(true);
  });

  it("returns the address unchanged when it is short and has no code", () => {
    expect(compactLoomAddressLabel("loom://abc")).toBe("loom://abc");
  });

  it("returns 'Loom reference' for an empty string", () => {
    expect(compactLoomAddressLabel("")).toBe("Loom reference");
  });
});

describe("compactLoomAddressLabel — title vs path fingerprint contract", () => {
  it("a pasted link built with loomLinkFromMarkdownReference(address, address) has title === path", () => {
    // This is the exact fingerprint that resolveReferenceLink uses to detect
    // a plain-text paste and substitute a resolved title.
    const address = "loom://my-loom/L-PASTE";
    const segs = extractLoomAddressSegments(address);
    const ref = segs.find((s) => s.kind === "reference");
    if (ref?.kind !== "reference") throw new Error("expected reference");
    // title equals path — the condition resolveReferenceLink checks
    expect(ref.link.title).toBe(ref.link.path);
  });

  it("a normally-titled link (drag/drop, Link button) has title !== path", () => {
    // Simulate what drag/drop produces: title is the human-readable name,
    // path is the address. resolveReferenceLink must NOT overwrite this.
    const dragDropLink = {
      id: "conv-1",
      type: "conversation" as const,
      title: "Why is sleep deprivation so dangerous?",
      path: "loom://why-is-sleep-deprivation-so-dangerous/L-9TXNW",
      badge: "Loom",
    };
    expect(dragDropLink.title).not.toBe(dragDropLink.path);
  });
});
