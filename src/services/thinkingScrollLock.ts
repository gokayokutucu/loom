export interface ShouldAutoScrollParams {
  now: number;
  manualScrollLockUntil: number;
  autoScrollEnabled: boolean;
  isNearBottom: boolean;
}

/**
 * Determines whether the ThinkingPanel live stream should auto-scroll to the bottom.
 * Auto-scroll is disabled if a scroll lock is currently active (now < manualScrollLockUntil).
 * Otherwise, it auto-scrolls if the user has auto-scroll enabled (want to follow tail)
 * or is currently scrolled near the bottom.
 */
export function shouldAutoScrollThinkingStream({
  now,
  manualScrollLockUntil,
  autoScrollEnabled,
  isNearBottom,
}: ShouldAutoScrollParams): boolean {
  if (now < manualScrollLockUntil) {
    return false;
  }
  return autoScrollEnabled || isNearBottom;
}
