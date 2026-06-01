import { describe, expect, it } from "vitest";
import {
  isAttachmentLink,
  isPersistedAttachmentId,
  mergeAttachmentLinksForSend,
  truncateFilenameForDisplay,
  type AttachmentForReference,
} from "./attachmentContext";
import type { LoomLink } from "../types";

// ── isAttachmentLink ──────────────────────────────────────────────────────────

describe("isAttachmentLink", () => {
  it("returns true for a link with type=attachment", () => {
    expect(isAttachmentLink({ type: "attachment", targetKind: undefined })).toBe(true);
  });
  it("returns true for a link with targetKind=attachment", () => {
    expect(isAttachmentLink({ type: "loom", targetKind: "attachment" })).toBe(true);
  });
  it("returns false for a regular reference link", () => {
    expect(isAttachmentLink({ type: "response", targetKind: "response" })).toBe(false);
  });
  it("returns false for a loom link", () => {
    expect(isAttachmentLink({ type: "loom", targetKind: "loom" })).toBe(false);
  });
});

// ── mergeAttachmentLinksForSend ───────────────────────────────────────────────

function makeLink(id: string, type: LoomLink["type"] = "response"): LoomLink {
  return { id, type, title: id, path: `loom://test/${id}` };
}

function makeAttachment(
  id: string,
  overrides: Partial<AttachmentForReference> = {}
): AttachmentForReference {
  return { id, name: `${id}.pdf`, ...overrides };
}

describe("mergeAttachmentLinksForSend", () => {
  it("returns existing links unchanged when no attachments", () => {
    const links = [makeLink("ref-1")];
    expect(mergeAttachmentLinksForSend(links, undefined)).toStrictEqual(links);
    expect(mergeAttachmentLinksForSend(links, [])).toStrictEqual(links);
  });

  it("converts tray attachment to LoomLink and appends it", () => {
    const result = mergeAttachmentLinksForSend([], [makeAttachment("att-abc")]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("att-abc");
    expect(result[0].type).toBe("attachment");
    expect(result[0].targetKind).toBe("attachment");
    expect(result[0].title).toBe("att-abc.pdf");
    expect(result[0].path).toContain("att-abc");
  });

  it("uses attachmentId over local id when present", () => {
    const att: AttachmentForReference = {
      id: "name:1234:99999",   // local pending key
      attachmentId: "att-xyz", // service-issued ID
      name: "report.pdf",
    };
    const result = mergeAttachmentLinksForSend([], [att]);
    expect(result[0].id).toBe("att-xyz");
  });

  it("builds loom-scoped path when loomId is present", () => {
    const att: AttachmentForReference = {
      id: "att-1",
      name: "data.csv",
      loomId: "loom-42",
    };
    const result = mergeAttachmentLinksForSend([], [att]);
    expect(result[0].path).toBe("loom://loom-42/attachments/att-1");
    expect(result[0].canonicalUri).toBe("loom://loom-42/attachments/att-1");
  });

  it("does not duplicate if attachment already present as inline token", () => {
    const existingAttachmentLink: LoomLink = {
      id: "att-already",
      type: "attachment",
      targetKind: "attachment",
      title: "file.pdf",
      path: "loom://attachments/att-already",
    };
    const result = mergeAttachmentLinksForSend(
      [existingAttachmentLink],
      [makeAttachment("att-already", { attachmentId: "att-already" })]
    );
    expect(result).toHaveLength(1); // no duplicate
    expect(result[0]).toBe(existingAttachmentLink);
  });

  it("preserves existing non-attachment links and appends attachment links after them", () => {
    const inlineRef = makeLink("response-ref");
    const result = mergeAttachmentLinksForSend(
      [inlineRef],
      [makeAttachment("att-1"), makeAttachment("att-2")]
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(inlineRef); // existing links come first
    expect(result[1].id).toBe("att-1");
    expect(result[2].id).toBe("att-2");
  });

  it("preserves order of multiple attachments", () => {
    const atts = ["att-a", "att-b", "att-c"].map((id) =>
      makeAttachment(id, { attachmentId: id })
    );
    const result = mergeAttachmentLinksForSend([], atts);
    expect(result.map((l) => l.id)).toEqual(["att-a", "att-b", "att-c"]);
  });

  it("sets badge=Image for image kind", () => {
    const result = mergeAttachmentLinksForSend([], [makeAttachment("att-img", { kind: "image" })]);
    expect(result[0].badge).toBe("Image");
  });

  it("sets badge=Unsupported file for unsupported parseStatus", () => {
    const result = mergeAttachmentLinksForSend(
      [],
      [makeAttachment("att-bad", { parseStatus: "unsupported" })]
    );
    expect(result[0].badge).toBe("Unsupported file");
  });

  it("sets badge=File by default", () => {
    const result = mergeAttachmentLinksForSend([], [makeAttachment("att-doc", { parseStatus: "ready" })]);
    expect(result[0].badge).toBe("File");
  });

  it("does not produce duplicate rows after max 10 attachments", () => {
    const atts = Array.from({ length: 10 }, (_, i) =>
      makeAttachment(`att-${i}`, { attachmentId: `att-${i}` })
    );
    const result = mergeAttachmentLinksForSend([], atts);
    const ids = result.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(10);
  });
});

// ── isPersistedAttachmentId ────────────────────────────────────────────────────
//
// Ensures that only service-issued IDs (att-*) pass the filter and that
// local pending keys do not leak into the model context or chip UI.

describe("isPersistedAttachmentId", () => {
  it("accepts a service-issued att- ID", () => {
    expect(isPersistedAttachmentId("att-abc123")).toBe(true);
  });

  it("accepts att- with uppercase hex digits", () => {
    expect(isPersistedAttachmentId("att-DEADBEEF")).toBe(true);
  });

  it("rejects a pending local key (name:size:lastModified format)", () => {
    expect(isPersistedAttachmentId("report.pdf:41234:1700000000000")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isPersistedAttachmentId("")).toBe(false);
  });

  it("rejects an arbitrary string without att- prefix", () => {
    expect(isPersistedAttachmentId("response-xyz-user")).toBe(false);
  });

  it("rejects a string that contains att- but does not start with it", () => {
    expect(isPersistedAttachmentId("prefix-att-xyz")).toBe(false);
  });

  it("rejects a loom ID (loom- prefix)", () => {
    expect(isPersistedAttachmentId("loom-12345678")).toBe(false);
  });
});

// ── truncateFilenameForDisplay ─────────────────────────────────────────────────
//
// Ensures filenames are truncated safely with extension preserved and no
// security-relevant characters introduced.

describe("truncateFilenameForDisplay", () => {
  it("returns the name unchanged when it fits within maxLen", () => {
    expect(truncateFilenameForDisplay("report.pdf", 32)).toBe("report.pdf");
  });

  it("truncates a long stem and appends ellipsis before the extension", () => {
    const name = "a-very-long-filename-that-exceeds-the-limit.pdf";
    const result = truncateFilenameForDisplay(name, 20);
    expect(result.endsWith(".pdf")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(21); // 20 chars + "…"
    expect(result).toContain("…");
  });

  it("preserves names with no extension", () => {
    const name = "this-is-a-long-name-without-extension";
    const result = truncateFilenameForDisplay(name, 10);
    expect(result).toContain("…");
    expect(result.length).toBeLessThanOrEqual(11);
  });

  it("handles a name equal to maxLen without truncation", () => {
    const name = "exactly32c.pdf";
    expect(truncateFilenameForDisplay(name, name.length)).toBe(name);
  });

  it("returns truncated form when name is one char over the limit", () => {
    const name = "abc.pdf"; // 7 chars
    const result = truncateFilenameForDisplay(name, 6);
    expect(result).toContain("…");
  });

  it("does not introduce path separators or special characters", () => {
    const name = "normal_file-name.docx";
    const result = truncateFilenameForDisplay(name, 12);
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
    expect(result).not.toContain("..");
  });
});
