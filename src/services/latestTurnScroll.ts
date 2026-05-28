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
