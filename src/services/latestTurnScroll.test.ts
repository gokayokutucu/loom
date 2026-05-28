import { describe, expect, test } from "vitest";
import {
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
