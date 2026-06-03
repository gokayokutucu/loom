export const THINKING_SCROLL_USER_PAUSE_MS = 2000;
export const THINKING_SCROLL_NEAR_BOTTOM_PX = 24;

export interface ShouldAutoScrollParams {
  now: number;
  userPauseUntil: number;
}

/**
 * Determines whether the ThinkingPanel live stream should auto-scroll to the bottom.
 * User scroll-up pauses follow temporarily; once that window expires, the next
 * incoming chunk resumes following even if the user is no longer near the bottom.
 */
export function shouldAutoScrollThinkingStream({
  now,
  userPauseUntil,
}: ShouldAutoScrollParams): boolean {
  return now >= userPauseUntil;
}

export function thinkingScrollPauseUntil(
  now: number,
  durationMs = THINKING_SCROLL_USER_PAUSE_MS
): number {
  return now + durationMs;
}

export interface ThinkingStreamNearBottomParams {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  thresholdPx?: number;
}

export function isThinkingStreamNearBottom({
  scrollHeight,
  scrollTop,
  clientHeight,
  thresholdPx = THINKING_SCROLL_NEAR_BOTTOM_PX,
}: ThinkingStreamNearBottomParams): boolean {
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}
