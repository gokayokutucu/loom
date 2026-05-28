export interface LatestTurnBoundaryRect {
  top: number;
  bottom: number;
}

export interface LatestTurnFollowInput {
  tailRect?: LatestTurnBoundaryRect | null;
  composerRect?: LatestTurnBoundaryRect | null;
  transcriptRect?: LatestTurnBoundaryRect | null;
  gap?: number;
}

export function latestTurnSafeBottom({
  composerRect,
  transcriptRect,
}: Pick<LatestTurnFollowInput, "composerRect" | "transcriptRect">) {
  if (!composerRect || !transcriptRect) return null;
  return Math.min(transcriptRect.bottom, composerRect.top);
}

export function shouldFollowLatestTurnTail({
  tailRect,
  composerRect,
  transcriptRect,
  gap = 24,
}: LatestTurnFollowInput) {
  const safeBottom = latestTurnSafeBottom({ composerRect, transcriptRect });
  if (!tailRect || safeBottom === null) return false;
  return tailRect.bottom >= safeBottom - gap;
}

export function latestTurnTailScrollDelta({
  tailRect,
  composerRect,
  transcriptRect,
  gap = 24,
}: LatestTurnFollowInput) {
  const safeBottom = latestTurnSafeBottom({ composerRect, transcriptRect });
  if (!tailRect || safeBottom === null) return null;
  return Math.max(0, tailRect.bottom - (safeBottom - gap));
}

// ---------------------------------------------------------------------------
// Real content overflow — used for scroll-to-bottom button visibility.
//
// The key insight: transcript.scrollHeight includes artificial CSS
// padding-bottom (.is-generating-response adds clamp(320px,52vh,560px)).
// We must NOT use scrollHeight to decide whether real content overflows
// the visible area.  Instead we compare the bounding rect of the last
// real DOM element (marked with [data-transcript-content-end]) against
// the safe viewport bottom (min of transcript bottom and composer top).
// ---------------------------------------------------------------------------

export interface RealContentOverflowInput {
  transcriptRect: LatestTurnBoundaryRect;
  composerTop: number | null;       // null when composer is not in DOM
  realContentEndBottom: number | null; // null when marker is not in DOM
  tolerance?: number;               // layout noise, default 4 px
}

/**
 * Returns true only when the last real rendered content element extends
 * past the visible safe viewport boundary.  Artificial padding, spacers,
 * and CSS `padding-bottom` on the transcript are NOT counted.
 *
 * @param transcriptRect  - getBoundingClientRect() of the transcript container
 * @param composerTop     - getBoundingClientRect().top of the active composer,
 *                          or null when the composer is not present
 * @param realContentEndBottom - getBoundingClientRect().bottom of the
 *                          [data-transcript-content-end] marker element,
 *                          or null when the marker is absent (e.g. no responses)
 * @param tolerance       - pixels of layout noise to ignore (default 4)
 */
export function hasRealContentBelowViewport({
  transcriptRect,
  composerTop,
  realContentEndBottom,
  tolerance = 4,
}: RealContentOverflowInput): boolean {
  if (realContentEndBottom === null) return false;
  const safeBottom =
    composerTop !== null
      ? Math.min(transcriptRect.bottom, composerTop)
      : transcriptRect.bottom;
  return realContentEndBottom > safeBottom + tolerance;
}

// ---------------------------------------------------------------------------
// First real assistant answer character gate.
//
// Returns false for: empty string, whitespace-only, thinking-only text,
// orphan markdown fence markers without body content.
// Returns true for: any non-whitespace visible character.
// ---------------------------------------------------------------------------

/**
 * Returns true only when the response has started producing real visible
 * answer text.  Must return false during the thinking-only phase so that
 * follow-eligibility and button visibility are not triggered by synthetic
 * layout space.
 */
export function hasRealAssistantAnswerStarted(markdownSource: string): boolean {
  const trimmed = markdownSource.trim();
  if (!trimmed) return false;
  // A lone code-fence marker (``` or similar) with no body is not real content.
  // e.g.  "```"  or  "```\n"  or  "```ts\n"  alone — first stream chunk
  // that hasn't accumulated enough to show text.
  if (/^`{1,3}[a-z]*\s*$/.test(trimmed)) return false;
  return true;
}
