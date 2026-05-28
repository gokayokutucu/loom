import { describe, expect, test } from "vitest";
import {
  hasRealAssistantAnswerStarted,
  hasRealContentBelowViewport,
  latestTurnSafeBottom,
  latestTurnTailScrollDelta,
  shouldFollowLatestTurnTail,
} from "./latestTurnScroll";

const transcriptRect = { top: 100, bottom: 700 };
const composerRect = { top: 620, bottom: 820 };

describe("latest-turn scroll geometry", () => {
  test("holds when tail bottom is far above composer boundary", () => {
    expect(
      shouldFollowLatestTurnTail({
        tailRect: { top: 240, bottom: 430 },
        composerRect,
        transcriptRect,
      })
    ).toBe(false);
  });

  test("follows when tail bottom is exactly near composer boundary", () => {
    expect(
      shouldFollowLatestTurnTail({
        tailRect: { top: 500, bottom: 596 },
        composerRect,
        transcriptRect,
        gap: 24,
      })
    ).toBe(true);
  });

  test("follows when tail bottom is below composer boundary", () => {
    expect(
      shouldFollowLatestTurnTail({
        tailRect: { top: 560, bottom: 650 },
        composerRect,
        transcriptRect,
      })
    ).toBe(true);
  });

  test("holds when tail is missing while anchor mode is active", () => {
    expect(
      shouldFollowLatestTurnTail({
        tailRect: null,
        composerRect,
        transcriptRect,
      })
    ).toBe(false);
  });

  test("holds when composer boundary is missing while anchor mode is active", () => {
    expect(
      shouldFollowLatestTurnTail({
        tailRect: { top: 560, bottom: 650 },
        composerRect: null,
        transcriptRect,
      })
    ).toBe(false);
  });

  test("ignores artificial padding below the measured tail", () => {
    expect(
      shouldFollowLatestTurnTail({
        tailRect: { top: 300, bottom: 420 },
        composerRect,
        transcriptRect,
      })
    ).toBe(false);
  });

  test("uses composer top when transcript bottom is lower than composer top", () => {
    expect(
      latestTurnSafeBottom({
        composerRect,
        transcriptRect: { top: 100, bottom: 760 },
      })
    ).toBe(620);
  });

  test("uses transcript bottom when transcript bottom is higher than composer top", () => {
    expect(
      latestTurnSafeBottom({
        composerRect,
        transcriptRect: { top: 100, bottom: 580 },
      })
    ).toBe(580);
  });

  test("computes scroll delta from tail to safe boundary", () => {
    expect(
      latestTurnTailScrollDelta({
        tailRect: { top: 590, bottom: 640 },
        composerRect,
        transcriptRect,
        gap: 24,
      })
    ).toBe(44);
  });
});

// ---------------------------------------------------------------------------
// hasRealContentBelowViewport — scroll-to-bottom button visibility
// ---------------------------------------------------------------------------
describe("hasRealContentBelowViewport", () => {
  // viewport: transcript top=0, bottom=600; composer at 550
  const txRect = { top: 0, bottom: 600 };
  const safeBottom = Math.min(600, 550); // = 550

  test("returns false when realContentEndBottom is null (no responses yet)", () => {
    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: 550,
        realContentEndBottom: null,
      })
    ).toBe(false);
  });

  test("returns false when real content end is within safe viewport", () => {
    // content ends at 400px — well above safeBottom=550
    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: 550,
        realContentEndBottom: 400,
      })
    ).toBe(false);
  });

  test("returns false when real content end is exactly at safe viewport boundary", () => {
    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: 550,
        realContentEndBottom: safeBottom, // exactly at boundary
      })
    ).toBe(false);
  });

  test("returns false when real content end is within tolerance of safe bottom", () => {
    // 3 px below boundary — within default 4 px tolerance
    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: 550,
        realContentEndBottom: safeBottom + 3,
        tolerance: 4,
      })
    ).toBe(false);
  });

  test("returns true when real content end exceeds safe bottom by more than tolerance", () => {
    // 10 px below boundary — definitely overflowing
    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: 550,
        realContentEndBottom: safeBottom + 10,
      })
    ).toBe(true);
  });

  test("ignores artificial padding — only real content bottom matters", () => {
    // Simulate: 300px of real content but +400px CSS padding-bottom inflating
    // scrollHeight.  Only realContentEndBottom=300 is passed in, so the
    // function correctly reports no overflow.
    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: 550,
        realContentEndBottom: 300, // real content is only 300px from top
      })
    ).toBe(false);
  });

  test("uses transcript bottom when composer is absent (composerTop null)", () => {
    // Without a composer, safeBottom = transcriptRect.bottom = 600
    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: null,
        realContentEndBottom: 605,
      })
    ).toBe(true);

    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: null,
        realContentEndBottom: 595,
      })
    ).toBe(false);
  });

  test("uses composer top when it is above transcript bottom", () => {
    // composer at 400 — that is the binding constraint
    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: 400,
        realContentEndBottom: 410, // just past composer top
      })
    ).toBe(true);

    expect(
      hasRealContentBelowViewport({
        transcriptRect: txRect,
        composerTop: 400,
        realContentEndBottom: 390,
      })
    ).toBe(false);
  });

  test("uses transcript bottom when it is above composer top", () => {
    // transcript bottom=300, composer at 500 — transcript is binding
    expect(
      hasRealContentBelowViewport({
        transcriptRect: { top: 0, bottom: 300 },
        composerTop: 500,
        realContentEndBottom: 310,
      })
    ).toBe(true);

    expect(
      hasRealContentBelowViewport({
        transcriptRect: { top: 0, bottom: 300 },
        composerTop: 500,
        realContentEndBottom: 295,
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasRealAssistantAnswerStarted — first answer character gate
// ---------------------------------------------------------------------------
describe("hasRealAssistantAnswerStarted", () => {
  test("returns false for empty string", () => {
    expect(hasRealAssistantAnswerStarted("")).toBe(false);
  });

  test("returns false for whitespace only", () => {
    expect(hasRealAssistantAnswerStarted("   ")).toBe(false);
    expect(hasRealAssistantAnswerStarted("\n\n")).toBe(false);
    expect(hasRealAssistantAnswerStarted("\t  \n")).toBe(false);
  });

  test("returns false for orphan code-fence marker without body (``` alone)", () => {
    expect(hasRealAssistantAnswerStarted("```")).toBe(false);
    expect(hasRealAssistantAnswerStarted("```\n")).toBe(false);
    expect(hasRealAssistantAnswerStarted("```ts\n")).toBe(false);
    expect(hasRealAssistantAnswerStarted("`")).toBe(false);
    expect(hasRealAssistantAnswerStarted("``")).toBe(false);
  });

  test("returns true for first real word", () => {
    expect(hasRealAssistantAnswerStarted("Event")).toBe(true);
    expect(hasRealAssistantAnswerStarted("Sure")).toBe(true);
  });

  test("returns true for markdown heading text", () => {
    expect(hasRealAssistantAnswerStarted("# Title")).toBe(true);
  });

  test("returns true for code fence with body content", () => {
    // A fence with actual code lines counts as real content
    expect(hasRealAssistantAnswerStarted("```ts\nconst x = 1;\n```")).toBe(true);
  });

  test("returns true for bullet-list item", () => {
    expect(hasRealAssistantAnswerStarted("- item one")).toBe(true);
  });

  test("returns true for single punctuation character", () => {
    // A period or colon is technically real content
    expect(hasRealAssistantAnswerStarted(".")).toBe(true);
  });

  test("thinking text is never passed here (callers extract only answer portion)", () => {
    // The function only cares about the answer markdown source, not thinking.
    // Verify it treats a realistic first answer chunk as started.
    expect(hasRealAssistantAnswerStarted("Event Sourcing keeps")).toBe(true);
  });
});
