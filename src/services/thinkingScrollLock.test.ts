import { describe, expect, it } from "vitest";
import { shouldAutoScrollThinkingStream } from "./thinkingScrollLock";

describe("shouldAutoScrollThinkingStream", () => {
  it("allows auto-scroll when auto-scroll is enabled and no scroll lock exists", () => {
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 0, autoScrollEnabled: true, isNearBottom: true })).toBe(true);
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 0, autoScrollEnabled: true, isNearBottom: false })).toBe(true);
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 1000, autoScrollEnabled: true, isNearBottom: true })).toBe(true);
  });

  it("allows auto-scroll when user is currently near bottom and lock has expired", () => {
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 0, autoScrollEnabled: false, isNearBottom: true })).toBe(true);
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 1000, autoScrollEnabled: false, isNearBottom: true })).toBe(true);
  });

  it("prevents auto-scroll when auto-scroll is disabled and user is away from bottom (not near bottom)", () => {
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 0, autoScrollEnabled: false, isNearBottom: false })).toBe(false);
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 1000, autoScrollEnabled: false, isNearBottom: false })).toBe(false);
  });

  it("prevents auto-scroll when locked (current time is before lock expiration) even if near bottom", () => {
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 1500, autoScrollEnabled: true, isNearBottom: true })).toBe(false);
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 1500, autoScrollEnabled: false, isNearBottom: true })).toBe(false);
    expect(shouldAutoScrollThinkingStream({ now: 1000, manualScrollLockUntil: 1500, autoScrollEnabled: false, isNearBottom: false })).toBe(false);
  });

  it("allows auto-scroll after the lock window expires if user was near bottom or auto-scroll was enabled", () => {
    expect(shouldAutoScrollThinkingStream({ now: 2000, manualScrollLockUntil: 1500, autoScrollEnabled: true, isNearBottom: false })).toBe(true);
    expect(shouldAutoScrollThinkingStream({ now: 2000, manualScrollLockUntil: 1500, autoScrollEnabled: false, isNearBottom: true })).toBe(true);
  });

  it("keeps auto-scroll disabled after lock expires if auto-scroll is disabled and user is not near bottom", () => {
    expect(shouldAutoScrollThinkingStream({ now: 2000, manualScrollLockUntil: 1500, autoScrollEnabled: false, isNearBottom: false })).toBe(false);
  });
});
