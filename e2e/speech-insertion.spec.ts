import { expect, test } from "@playwright/test";
import { insertTranscriptAtCursorText } from "../src/services/speechTranscriptInsertion";

test.describe("speech transcript cursor insertion", () => {
  test("inserts at the beginning with trailing space", () => {
    expect(
      insertTranscriptAtCursorText({
        text: "Let's improve this.",
        selectionStart: 0,
        selectionEnd: 0,
        transcript: "Absolutely.",
      })
    ).toMatchObject({
      text: "Absolutely. Let's improve this.",
      insertedText: "Absolutely. ",
      caretIndex: "Absolutely. ".length,
      changed: true,
    });
  });

  test("inserts in the middle with both sides preserved", () => {
    expect(
      insertTranscriptAtCursorText({
        text: "Explain Loom",
        selectionStart: "Explain".length,
        selectionEnd: "Explain".length,
        transcript: "local first runtime",
      }).text
    ).toBe("Explain local first runtime Loom");
  });

  test("inserts at the end with leading space", () => {
    expect(
      insertTranscriptAtCursorText({
        text: "Explain Loom",
        selectionStart: "Explain Loom".length,
        selectionEnd: "Explain Loom".length,
        transcript: "with examples",
      }).text
    ).toBe("Explain Loom with examples");
  });

  test("does not duplicate existing spaces", () => {
    expect(
      insertTranscriptAtCursorText({
        text: "Explain  Loom",
        selectionStart: "Explain ".length,
        selectionEnd: "Explain ".length,
        transcript: "local first runtime",
      }).text
    ).toBe("Explain local first runtime Loom");
  });

  test("replaces selected text", () => {
    expect(
      insertTranscriptAtCursorText({
        text: "Explain old runtime Loom",
        selectionStart: "Explain ".length,
        selectionEnd: "Explain old runtime".length,
        transcript: "local first",
      }).text
    ).toBe("Explain local first Loom");
  });

  test("empty transcript leaves input unchanged", () => {
    expect(
      insertTranscriptAtCursorText({
        text: "Explain Loom",
        selectionStart: 7,
        selectionEnd: 7,
        transcript: "   ",
      })
    ).toMatchObject({
      text: "Explain Loom",
      insertedText: "",
      caretIndex: 7,
      changed: false,
    });
  });
});
