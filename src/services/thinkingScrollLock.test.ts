import { describe, expect, it } from "vitest";
import {
  isThinkingStreamNearBottom,
  shouldAutoScrollThinkingStream,
  thinkingScrollPauseUntil,
  THINKING_SCROLL_USER_PAUSE_MS,
} from "./thinkingScrollLock";

describe("shouldAutoScrollThinkingStream", () => {
  it("prevents auto-follow while the user pause window is active", () => {
    expect(
      shouldAutoScrollThinkingStream({ now: 1000, userPauseUntil: 2999 })
    ).toBe(false);
  });

  it("resumes auto-follow when the user pause expires even away from bottom", () => {
    expect(
      shouldAutoScrollThinkingStream({ now: 3000, userPauseUntil: 3000 })
    ).toBe(true);
    expect(
      shouldAutoScrollThinkingStream({ now: 3001, userPauseUntil: 3000 })
    ).toBe(true);
  });

  it("auto-follows when no user pause has been created", () => {
    expect(shouldAutoScrollThinkingStream({ now: 1000, userPauseUntil: 0 })).toBe(
      true
    );
  });
});

describe("thinkingScrollPauseUntil", () => {
  it("creates a two-second user pause", () => {
    expect(thinkingScrollPauseUntil(1000)).toBe(
      1000 + THINKING_SCROLL_USER_PAUSE_MS
    );
  });

  it("extends the pause when the user scrolls up again", () => {
    const firstPauseUntil = thinkingScrollPauseUntil(1000);
    const extendedPauseUntil = thinkingScrollPauseUntil(2500);

    expect(extendedPauseUntil).toBeGreaterThan(firstPauseUntil);
  });
});

describe("isThinkingStreamNearBottom", () => {
  it("detects the bottom threshold", () => {
    expect(
      isThinkingStreamNearBottom({
        scrollHeight: 1000,
        scrollTop: 775,
        clientHeight: 200,
      })
    ).toBe(false);

    expect(
      isThinkingStreamNearBottom({
        scrollHeight: 1000,
        scrollTop: 776,
        clientHeight: 200,
      })
    ).toBe(true);
  });

  it("treats exact bottom as near bottom", () => {
    expect(
      isThinkingStreamNearBottom({
        scrollHeight: 1000,
        scrollTop: 800,
        clientHeight: 200,
      })
    ).toBe(true);
  });

  it("supports a custom threshold", () => {
    expect(
      isThinkingStreamNearBottom({
        scrollHeight: 1000,
        scrollTop: 740,
        clientHeight: 200,
        thresholdPx: 64,
      })
    ).toBe(true);
  });
});
