import { describe, expect, it } from "vitest";
import { isPersistedAttachmentId, truncateFilenameForDisplay } from "./attachmentContext";

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
