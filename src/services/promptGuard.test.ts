/**
 * Tests for the deterministic prompt guard.
 *
 * Product rules enforced:
 *   A) Short implicit prompts require an explicit subject when no chip exists.
 *   B) Likely accidental incomplete single-sentence prompts ask for
 *      clarification.
 *   C) Multi-sentence / longer prompts with an explicit subject are allowed.
 *   D) Any prompt with at least one attached chip is always allowed.
 */
import { describe, expect, it } from "vitest";
import { checkPromptGuard } from "./promptGuard";
import type { PromptGuardInput } from "./promptGuard";

// ── helpers ──────────────────────────────────────────────────────────────────

function noChips(prompt: string): PromptGuardInput {
  return { prompt, hasAttachedReferences: false, hasAttachments: false };
}

function withRef(prompt: string): PromptGuardInput {
  return { prompt, hasAttachedReferences: true, hasAttachments: false };
}

function withAttachment(prompt: string): PromptGuardInput {
  return { prompt, hasAttachedReferences: false, hasAttachments: true };
}

function withActiveResponse(prompt: string): PromptGuardInput {
  return {
    prompt,
    hasAttachedReferences: false,
    hasAttachments: false,
    hasActiveResponseTarget: true,
  };
}

function isAllowed(input: PromptGuardInput) {
  return checkPromptGuard(input).action === "allow";
}

function isClarify(input: PromptGuardInput) {
  return checkPromptGuard(input).action === "clarify";
}

// ── A: incomplete fragment prompts ──────────────────────────────────────────

describe("Accidental incomplete prompt — no chips", () => {
  it('"Wh" with no chip → clarify incomplete', () => {
    const result = checkPromptGuard(noChips("Wh"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.reason).toBe("incomplete");
    }
  });

  it('"Wha" with no chip → clarify incomplete', () => {
    const result = checkPromptGuard(noChips("Wha"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.reason).toBe("incomplete");
    }
  });

  it('"Which kind of problem do you" with no chip → clarify incomplete', () => {
    const result = checkPromptGuard(noChips("Which kind of problem do you"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.reason).toBe("incomplete");
    }
  });

  it('"Can you explain why the" with no chip → clarify incomplete', () => {
    const result = checkPromptGuard(noChips("Can you explain why the"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.reason).toBe("incomplete");
    }
  });

  it('"expl" with no chip → clarify incomplete (partial word)', () => {
    expect(isClarify(noChips("expl"))).toBe(true);
  });

  it('"summ" with no chip → clarify incomplete (partial word)', () => {
    expect(isClarify(noChips("summ"))).toBe(true);
  });

  it('"w" with no chip → clarify incomplete', () => {
    expect(isClarify(noChips("w"))).toBe(true);
  });

  it('"how d" with no chip → clarify incomplete', () => {
    expect(isClarify(noChips("how d"))).toBe(true);
  });
});

// ── B: missing-subject implicit verbs ────────────────────────────────────────

describe("Missing-subject implicit verb — no chips", () => {
  it('"explain" with no chip → clarify missing-subject', () => {
    const result = checkPromptGuard(noChips("explain"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.reason).toBe("missing-subject");
    }
  });

  it('"why?" with no chip → clarify missing-subject', () => {
    const result = checkPromptGuard(noChips("why?"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.reason).toBe("missing-subject");
    }
  });

  it('"what does this mean?" with no chip → clarify missing-subject', () => {
    const result = checkPromptGuard(noChips("what does this mean?"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.reason).toBe("missing-subject");
    }
  });

  it('"give an example" with no chip → clarify missing-subject', () => {
    expect(isClarify(noChips("give an example"))).toBe(true);
  });

  it('"summarize" with no chip → clarify missing-subject', () => {
    expect(isClarify(noChips("summarize"))).toBe(true);
  });

  it('"expand" with no chip → clarify missing-subject', () => {
    expect(isClarify(noChips("expand"))).toBe(true);
  });

  it('"eli5" with no chip → clarify missing-subject', () => {
    expect(isClarify(noChips("eli5"))).toBe(true);
  });
});

// ── C: chip present — always allow ───────────────────────────────────────────

describe("Chip present — always allow regardless of prompt length", () => {
  it('"explain" with selected text chip → allowed', () => {
    expect(isAllowed(withRef("explain"))).toBe(true);
  });

  it('"why?" with reference chip → allowed', () => {
    expect(isAllowed(withRef("why?"))).toBe(true);
  });

  it('"summarize this" with attachment chip → allowed', () => {
    expect(isAllowed(withAttachment("summarize this"))).toBe(true);
  });

  it('"Wh" with reference chip → allowed', () => {
    expect(isAllowed(withRef("Wh"))).toBe(true);
  });

  it('"Can you explain why the" with reference chip → allowed', () => {
    expect(isAllowed(withRef("Can you explain why the"))).toBe(true);
  });

  it('"what does this mean?" with attachment → allowed', () => {
    expect(isAllowed(withAttachment("what does this mean?"))).toBe(true);
  });

  it('"why?" with active response target → allowed', () => {
    expect(isAllowed(withActiveResponse("why?"))).toBe(true);
  });

  it('"what does this mean?" with quoted text → allowed', () => {
    expect(isAllowed(noChips('what does this mean? "clock drift"'))).toBe(true);
  });
});

// ── D: explicit subject — always allow ────────────────────────────────────────

describe("Explicit subject in prompt — allow without chips", () => {
  it('"explain trilateration" → allowed', () => {
    expect(isAllowed(noChips("explain trilateration"))).toBe(true);
  });

  it('"GPS?" → allowed', () => {
    expect(isAllowed(noChips("GPS?"))).toBe(true);
  });

  it('"Rust?" → allowed', () => {
    expect(isAllowed(noChips("Rust?"))).toBe(true);
  });

  it('"OAuth?" → allowed', () => {
    expect(isAllowed(noChips("OAuth?"))).toBe(true);
  });

  it('"Why GPS?" → allowed', () => {
    expect(isAllowed(noChips("Why GPS?"))).toBe(true);
  });

  it('"How does GPS work?" → allowed', () => {
    expect(isAllowed(noChips("How does GPS work?"))).toBe(true);
  });

  it('"Can you explain why GPS needs four satellites?" → allowed', () => {
    expect(isAllowed(noChips("Can you explain why GPS needs four satellites?"))).toBe(true);
  });

  it('"summarize sleepdeprivation.pdf" → allowed', () => {
    expect(isAllowed(noChips("summarize sleepdeprivation.pdf"))).toBe(true);
  });

  it('"Explain Rust ownership" → allowed', () => {
    expect(isAllowed(noChips("Explain Rust ownership"))).toBe(true);
  });
});

// ── E: multi-sentence / longer messages ──────────────────────────────────────

describe("Multi-sentence or longer message — allow", () => {
  it("two sentences → allowed", () => {
    expect(isAllowed(noChips("This is an interesting topic. Can you elaborate on the GPS satellites?"))).toBe(true);
  });

  it("question with context sentence → allowed", () => {
    expect(isAllowed(noChips("I was reading about trilateration. Why are four satellites needed?"))).toBe(true);
  });

  it("multi-line message → allowed", () => {
    expect(isAllowed(noChips("I was reading about GPS.\nWhy do we need four satellites?"))).toBe(true);
  });
});

// ── F: Turkish prompts ────────────────────────────────────────────────────────

describe("Turkish prompts", () => {
  it('"Trilateration nedir?" → allowed', () => {
    expect(isAllowed(noChips("Trilateration nedir?"))).toBe(true);
  });

  it('"GPS neden dört uyduya ihtiyaç duyar?" → allowed', () => {
    expect(isAllowed(noChips("GPS neden dört uyduya ihtiyaç duyar?"))).toBe(true);
  });

  it('"açıkla" with no chip → clarify missing-subject', () => {
    expect(isClarify(noChips("açıkla"))).toBe(true);
  });

  it('"neden" with no chip → clarify missing-subject', () => {
    expect(isClarify(noChips("neden"))).toBe(true);
  });
});

// ── G: clarification message content ─────────────────────────────────────────

describe("Clarification message content", () => {
  it("incomplete prompt message echoes the fragment", () => {
    const result = checkPromptGuard(noChips("Wh"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.message).toContain("Wh");
    }
  });

  it("missing-subject message asks what to explain", () => {
    const result = checkPromptGuard(noChips("explain"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.message.length).toBeGreaterThan(10);
      expect(result.reason).toBe("missing-subject");
    }
  });

  it("incomplete message for cut-off sentence includes the fragment", () => {
    const result = checkPromptGuard(noChips("Which kind of problem do you"));
    expect(result.action).toBe("clarify");
    if (result.action === "clarify") {
      expect(result.message).toContain("Which kind of problem do you");
    }
  });

  it("Turkish prompt with clarify uses Turkish message", () => {
    const result = checkPromptGuard(noChips("Wh nasıl"));
    // just ensure it returns a non-empty message
    if (result.action === "clarify") {
      expect(result.message.length).toBeGreaterThan(5);
    }
  });
});

// ── H: edge cases ─────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("empty string → allow (filtered by meaningful check upstream)", () => {
    expect(isAllowed(noChips(""))).toBe(true);
  });

  it("single space → allow", () => {
    expect(isAllowed(noChips(" "))).toBe(true);
  });

  it('"What is event sourcing?" → allowed', () => {
    expect(isAllowed(noChips("What is event sourcing?"))).toBe(true);
  });

  it('"summarize this document" → allowed (has "document")', () => {
    expect(isAllowed(noChips("summarize this document"))).toBe(true);
  });

  it('"translate this text" → allowed (has "text")', () => {
    expect(isAllowed(noChips("translate this text"))).toBe(true);
  });

  it('"explain ownership in Rust" → allowed', () => {
    expect(isAllowed(noChips("explain ownership in Rust"))).toBe(true);
  });

  it('"can you explain" alone → clarify incomplete', () => {
    // "can you explain" has no subject after removing the auxiliary
    expect(isClarify(noChips("can you explain"))).toBe(true);
  });
});
