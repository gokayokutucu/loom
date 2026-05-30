import { describe, expect, it } from "vitest";
import {
  cleanReferenceDisplayLabel,
  referenceLabelForMode,
  referenceTokenText,
  withReferenceDisplayDefaults,
} from "./referenceDisplay";
import type { LoomLink } from "../types";

function makeLink(overrides: Partial<LoomLink> = {}): LoomLink {
  return {
    id: "ref-1",
    type: "response",
    title: "Fallback title",
    path: "loom://example/response?id=ref-1",
    badge: "Response",
    ...overrides,
  };
}

describe("reference display normalization", () => {
  it("removes Markdown heading markers from reference labels", () => {
    expect(
      cleanReferenceDisplayLabel("# Satellite Requirements for GPS Location ## Context from Signal Timing")
    ).toBe("Satellite Requirements for GPS Location Context from Signal Timing");
  });

  it("removes token wrappers and heading markers from chip text", () => {
    const link = makeLink({
      referenceCustomLabel:
        "[[# Satellite Requirements for GPS Location ## Context from Signal Timing ]]",
    });

    expect(referenceTokenText(link, "title")).toBe(
      "[[Satellite Requirements for GPS Location Context from Signal Timing]]"
    );
  });

  it("removes fenced-code language markers such as csharp", () => {
    expect(cleanReferenceDisplayLabel("```csharp\npublic class Program\n```")).toBe(
      "public class Program"
    );
  });

  it("normalizes title and custom label defaults used by composer chips", () => {
    const link = withReferenceDisplayDefaults(
      makeLink({
        title: "# Bookmark Title",
        referenceCustomLabel: "```csharp\nSelected reference\n```",
      }),
      "title"
    );

    expect(link.title).toBe("Bookmark Title");
    expect(link.referenceCustomLabel).toBe("Selected reference");
    expect(referenceLabelForMode(link, "title")).toBe("Selected reference");
  });
});
