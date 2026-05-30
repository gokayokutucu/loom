/**
 * Selection-Ask focus authority tests.
 *
 * Product rule:
 *   When Ask to Loom is invoked from selected text:
 *   1. The selected text is the primary subject.
 *   2. The source response is supporting background only.
 *   3. Short prompts (explain, why?, what does this mean?, give an example)
 *      bind to the selected fragment.
 *   4. The model must not restate/summarize the full source response unless
 *      explicitly asked.
 *
 * Root causes addressed (from SELECTION-ASK-FOCUS-AUTHORITY-AUDIT-001):
 *   E — prompt lacked selected-text focus instruction
 *   D — fragment included but equal priority to full source response
 *   G — no tests for Ask to Loom path with short prompts
 */
import { describe, expect, it } from "vitest";
import { buildLoomContext } from "./loomContextBuilder";
import type { LoomContextBuilderInput, LoomContextReference } from "./loomContextBuilder";
import { AttachedReferencesContributor } from "./contextContributors";
import {
  planAnswerDeterministically,
  anchorShortPromptToFragment,
} from "./answerPlanner";
import type { LoomLink } from "../types";
import type { ResponseContextCapsule } from "./responseContextCapsule";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeCapsule(overrides: Partial<ResponseContextCapsule> = {}): ResponseContextCapsule {
  return {
    sourceLoomId: "loom-1",
    sourceResponseId: "resp-1",
    loomId: "loom-1",
    responseId: "resp-1",
    title: "GPS Explained",
    summary: "GPS relies on satellites to determine positions on Earth.",
    keyPoints: ["Satellites broadcast signals", "Receivers calculate position"],
    keywords: ["GPS", "satellite", "position"],
    entities: ["GPS", "satellite"],
    sourceLength: 500,
    capsuleSource: "heuristic",
    generatedBy: "heuristic",
    updatedAt: 1,
    ...overrides,
  };
}

function makeFragmentReference(selectedText: string): LoomContextReference {
  const link: LoomLink = {
    id: "resp-1",
    type: "fragment",
    title: "GPS Explained",
    path: "loom://test/r/R-GPS",
    badge: "Selection",
    selectedText,
    sourceResponseId: "resp-1",
  };
  return {
    link,
    capsule: makeCapsule({ selectedText }),
  };
}

function makeFullResponseReference(): LoomContextReference {
  const link: LoomLink = {
    id: "resp-2",
    type: "response",
    title: "GPS Overview",
    path: "loom://test/r/R-OVR",
    badge: "Response",
  };
  return {
    link,
    capsule: makeCapsule(),
  };
}

const FRAGMENT_TEXT = "The Process of Trilateration";

function baseBuilderInput(
  overrides: Partial<LoomContextBuilderInput> = {}
): LoomContextBuilderInput {
  return {
    loomId: "loom-1",
    newUserPrompt: "explain",
    attachedReferences: [],
    responseMode: "auto",
    resolvedNumCtx: 8192,
    responses: [],
    forkRecords: [],
    ...overrides,
  };
}

// ── Fix 2: renderCapsule ordering ────────────────────────────────────────────

describe("buildLoomContext — renderCapsule with selected fragment", () => {
  it("places 'Primary selected fragment' before 'Background source summary' in context", () => {
    const output = buildLoomContext(
      baseBuilderInput({ attachedReferences: [makeFragmentReference(FRAGMENT_TEXT)] })
    );
    const block = output.context.join("\n");
    const fragmentPos = block.indexOf("Primary selected fragment:");
    const summaryPos = block.indexOf("Background source summary:");
    expect(fragmentPos).toBeGreaterThan(-1);
    expect(summaryPos).toBeGreaterThan(-1);
    expect(fragmentPos).toBeLessThan(summaryPos);
  });

  it("does not use 'Primary selected fragment' label when no selectedText is present", () => {
    const output = buildLoomContext(
      baseBuilderInput({ attachedReferences: [makeFullResponseReference()] })
    );
    const block = output.context.join("\n");
    expect(block).not.toContain("Primary selected fragment:");
    expect(block).toContain("Summary:");
  });

  it("demotes key points to 'Background key points' when selectedText is present", () => {
    const output = buildLoomContext(
      baseBuilderInput({ attachedReferences: [makeFragmentReference(FRAGMENT_TEXT)] })
    );
    const block = output.context.join("\n");
    expect(block).toContain("Background key points:");
  });

  it("keeps 'Key points' label unchanged when no selectedText", () => {
    const output = buildLoomContext(
      baseBuilderInput({ attachedReferences: [makeFullResponseReference()] })
    );
    const block = output.context.join("\n");
    expect(block).toContain("Key points:");
    expect(block).not.toContain("Background key points:");
  });
});

// ── Fix 1: system prompt contract ────────────────────────────────────────────

describe("buildLoomContext — system prompt fragment-focus contract", () => {
  it("includes selected-fragment focus clause when a fragment reference is attached", () => {
    const output = buildLoomContext(
      baseBuilderInput({ attachedReferences: [makeFragmentReference(FRAGMENT_TEXT)] })
    );
    expect(output.system).toContain("A selected fragment is attached as a reference.");
    expect(output.system).toContain("Treat the selected fragment as the primary subject");
    expect(output.system).toContain("Use the source response only as supporting background.");
  });

  it("includes the short-prompt enumeration in the focus clause", () => {
    const output = buildLoomContext(
      baseBuilderInput({ attachedReferences: [makeFragmentReference(FRAGMENT_TEXT)] })
    );
    expect(output.system).toContain('"explain"');
    expect(output.system).toContain('"why?"');
    expect(output.system).toContain('"what does this mean?"');
    expect(output.system).toContain('"give an example"');
  });

  it("explicitly instructs the model not to summarize the full source response", () => {
    const output = buildLoomContext(
      baseBuilderInput({ attachedReferences: [makeFragmentReference(FRAGMENT_TEXT)] })
    );
    expect(output.system).toContain(
      "Do not restate or summarize the full source response unless the user explicitly asks for that."
    );
  });

  it("does NOT include the fragment-focus clause when no fragment reference is attached", () => {
    const output = buildLoomContext(baseBuilderInput());
    expect(output.system).not.toContain("selected fragment");
  });

  it("does NOT include the fragment-focus clause for a full-response reference without selectedText", () => {
    const output = buildLoomContext(
      baseBuilderInput({ attachedReferences: [makeFullResponseReference()] })
    );
    expect(output.system).not.toContain("selected fragment");
  });
});

// ── Fix 3: AttachedReferencesContributor ─────────────────────────────────────

describe("AttachedReferencesContributor — selectedText inclusion", () => {
  it("includes 'Primary selected fragment' label when capsule has selectedText", async () => {
    const input = baseBuilderInput({
      attachedReferences: [makeFragmentReference(FRAGMENT_TEXT)],
    });
    const contribution = await AttachedReferencesContributor.contribute(input);
    expect(contribution.content).toContain("Primary selected fragment:");
    expect(contribution.content).toContain(FRAGMENT_TEXT);
  });

  it("labels source summary as 'Background source summary' when selectedText is present", async () => {
    const input = baseBuilderInput({
      attachedReferences: [makeFragmentReference(FRAGMENT_TEXT)],
    });
    const contribution = await AttachedReferencesContributor.contribute(input);
    expect(contribution.content).toContain("Background source summary:");
  });

  it("does NOT include 'Primary selected fragment' when no selectedText", async () => {
    const input = baseBuilderInput({
      attachedReferences: [makeFullResponseReference()],
    });
    const contribution = await AttachedReferencesContributor.contribute(input);
    expect(contribution.content).not.toContain("Primary selected fragment:");
    expect(contribution.content).not.toContain("Background source summary:");
  });

  it("places selected fragment before background summary in rendered output", async () => {
    const input = baseBuilderInput({
      attachedReferences: [makeFragmentReference(FRAGMENT_TEXT)],
    });
    const contribution = await AttachedReferencesContributor.contribute(input);
    const fragmentPos = contribution.content.indexOf("Primary selected fragment:");
    const summaryPos = contribution.content.indexOf("Background source summary:");
    expect(fragmentPos).toBeLessThan(summaryPos);
  });
});

// ── Fix 4: anchorShortPromptToFragment ───────────────────────────────────────

describe("anchorShortPromptToFragment", () => {
  it("combines short prompt verb with fragment text", () => {
    const result = anchorShortPromptToFragment("explain", FRAGMENT_TEXT);
    expect(result).toBe(`explain: "${FRAGMENT_TEXT}"`);
  });

  it("strips trailing question mark from prompt", () => {
    const result = anchorShortPromptToFragment("why?", FRAGMENT_TEXT);
    expect(result).toBe(`why: "${FRAGMENT_TEXT}"`);
  });

  it("strips trailing exclamation mark from prompt", () => {
    const result = anchorShortPromptToFragment("expand!", FRAGMENT_TEXT);
    expect(result).toBe(`expand: "${FRAGMENT_TEXT}"`);
  });

  it("handles multi-word short prompt", () => {
    const result = anchorShortPromptToFragment("what does this mean?", FRAGMENT_TEXT);
    expect(result).toBe(`what does this mean: "${FRAGMENT_TEXT}"`);
  });

  it("truncates very long fragment text to 200 chars", () => {
    const longText = "x".repeat(300);
    const result = anchorShortPromptToFragment("explain", longText);
    expect(result.length).toBeLessThan(300);
    expect(result).toContain("explain:");
  });
});

// ── Fix 4: planAnswerDeterministically short-prompt anchoring ─────────────────

function makeFragmentLink(selectedText: string): LoomLink {
  return {
    id: "resp-1",
    type: "fragment",
    title: "GPS Explained",
    path: "loom://test/r/R-GPS",
    badge: "Selection",
    selectedText,
    sourceResponseId: "resp-1",
  };
}

describe("planAnswerDeterministically — short-prompt fragment anchoring", () => {
  const SHORT_PROMPTS = ["explain", "why?", "what does this mean?", "give an example", "expand", "eli5"];

  SHORT_PROMPTS.forEach((prompt) => {
    it(`rewrites "${prompt}" to anchor to selected fragment`, () => {
      const plan = planAnswerDeterministically({
        cleanUserPrompt: prompt,
        attachedReferences: [makeFragmentLink(FRAGMENT_TEXT)],
        selectedResponseMode: "auto",
      });
      expect(plan.rewrittenPrompt).toBeDefined();
      expect(plan.rewrittenPrompt).toContain(FRAGMENT_TEXT);
    });
  });

  it("rewritten prompt for 'explain' starts with the verb, not the fragment", () => {
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "explain",
      attachedReferences: [makeFragmentLink(FRAGMENT_TEXT)],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toMatch(/^explain:/i);
  });

  it("does NOT rewrite when prompt explicitly asks for the whole answer", () => {
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "summarize the whole answer",
      attachedReferences: [makeFragmentLink(FRAGMENT_TEXT)],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toBeUndefined();
  });

  it("does NOT rewrite when prompt explicitly asks for the full response", () => {
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "explain the entire response",
      attachedReferences: [makeFragmentLink(FRAGMENT_TEXT)],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toBeUndefined();
  });

  it("does NOT rewrite when prompt is long (>= 300 chars) even with a fragment ref", () => {
    const longPrompt = "explain this concept in detail and relate it to the rest of the answer".padEnd(350, " and more");
    const plan = planAnswerDeterministically({
      cleanUserPrompt: longPrompt,
      attachedReferences: [makeFragmentLink(FRAGMENT_TEXT)],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toBeUndefined();
  });

  it("does NOT rewrite when there is no fragment reference (only a full-response ref)", () => {
    const nonFragmentLink: LoomLink = {
      id: "resp-2",
      type: "response",
      title: "GPS Overview",
      path: "loom://test/r/R-OVR",
      badge: "Response",
    };
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "explain",
      attachedReferences: [nonFragmentLink],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toBeUndefined();
  });

  it("does NOT rewrite when fragment reference has no selectedText", () => {
    const fragmentWithoutText: LoomLink = {
      id: "resp-3",
      type: "fragment",
      title: "GPS Explained",
      path: "loom://test/r/R-GPS",
      badge: "Selection",
      sourceResponseId: "resp-1",
      // no selectedText
    };
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "explain",
      attachedReferences: [fragmentWithoutText],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toBeUndefined();
  });

  it("does NOT rewrite when no references are attached (simpleFactual path)", () => {
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "explain",
      attachedReferences: [],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toBeUndefined();
  });

  // ── Regression: explicit full-source requests ─────────────────────────────

  it("'summarize the full response' does not suppress source context (no rewrite)", () => {
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "summarize the full response",
      attachedReferences: [makeFragmentLink(FRAGMENT_TEXT)],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toBeUndefined();
  });

  it("'explain all of this' does not rewrite to fragment", () => {
    const plan = planAnswerDeterministically({
      cleanUserPrompt: "explain all of this",
      attachedReferences: [makeFragmentLink(FRAGMENT_TEXT)],
      selectedResponseMode: "auto",
    });
    expect(plan.rewrittenPrompt).toBeUndefined();
  });
});
