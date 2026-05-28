// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
// - Test data is created through the product composer and cleaned up by the harness.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function fillPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
}

test.describe("[product-service-backed] Main composer submit", () => {
  test("double submit does not create duplicate Looms", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 2,
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const prompt = `Duplicate submit guard ${Date.now()} local-first runtime proof`;
      await fillPrompt(page, prompt);

      await page.getByRole("button", { name: "Send" }).evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });

      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Event Sourcing",
        { timeout: 30_000 }
      );

      const looms = await scenario.client.listLooms();
      expect(looms).toHaveLength(1);

      await expect
        .poll(
          async () => {
            const detail = await scenario.fetchJson<{
              loom: { responses: Array<{ role: "user" | "assistant"; content: string }> };
            }>(`/looms/${encodeURIComponent(looms[0].loomId)}`);
            return detail.loom.responses.map((response) => response.role);
          },
          { timeout: 30_000 }
        )
        .toEqual(["user", "assistant"]);
      const rawDetail = await scenario.fetchJson<{
        loom: { responses: Array<{ role: "user" | "assistant"; content: string }> };
      }>(`/looms/${encodeURIComponent(looms[0].loomId)}`);
      expect(rawDetail.loom.responses.filter((response) => response.role === "user")).toHaveLength(1);
      expect(rawDetail.loom.responses.filter((response) => response.role === "assistant")).toHaveLength(1);
      expect(rawDetail.loom.responses[0].content).toContain("Duplicate submit guard");
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("holds anchored viewport until the real response tail reaches the composer", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 60,
      deterministicThinkingDelayMs: 1_500,
      startApp: true,
    });

    const readLatestTurnMetrics = () =>
      page.locator(".qa-item").last().evaluate((item) => {
        const transcript = item.closest(".chat-transcript");
        const userTurn = item.querySelector<HTMLElement>("[data-prompt-response-id]");
        const tail = item.querySelector<HTMLElement>("[data-response-tail]");
        const composer = document.querySelector<HTMLElement>(
          ".prompt-composer.active:not(.centered)[data-testid='prompt-composer']"
        );
        if (!transcript || !userTurn || !tail || !composer) return null;
        const transcriptRect = transcript.getBoundingClientRect();
        const userTurnRect = userTurn.getBoundingClientRect();
        const tailRect = tail.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const safeBottom = Math.min(transcriptRect.bottom, composerRect.top);
        return {
          promptTop: userTurnRect.top - transcriptRect.top,
          tailBottom: tailRect.bottom,
          composerTop: composerRect.top,
          safeBottom,
          visibleGap: safeBottom - tailRect.bottom,
          transcriptHeight: transcriptRect.height,
          scrollTop: (transcript as HTMLElement).scrollTop,
          scrollHeight: (transcript as HTMLElement).scrollHeight,
          clientHeight: (transcript as HTMLElement).clientHeight,
        };
      });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({
            mockDataEnabled: false,
            modelResponseMode: "thinking",
          })
        );
      });
      await page.setViewportSize({ width: 500, height: 784 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `hold-overflow-seed-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 15_000,
      });

      await page.locator(".chat-transcript").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

      await fillPrompt(page, `hold-overflow-anchor-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 15_000,
      });

      await expect
        .poll(
          async () => {
            const m = await readLatestTurnMetrics();
            if (!m) return -1;
            return m.promptTop;
          },
          { timeout: 8_000 }
        )
        .toBeGreaterThanOrEqual(-16);

      const thinkingMetrics = await readLatestTurnMetrics();
      expect(thinkingMetrics).not.toBeNull();
      expect(thinkingMetrics!.promptTop).toBeGreaterThanOrEqual(-16);
      expect(thinkingMetrics!.promptTop).toBeLessThanOrEqual(300);

      await expect(page.locator(".thinking-panel.is-running").last()).not.toBeVisible({
        timeout: 5_000,
      });
      await page.waitForTimeout(40);

      const earlyMetrics = await readLatestTurnMetrics();
      expect(earlyMetrics).not.toBeNull();
      expect(earlyMetrics!.visibleGap).toBeGreaterThan(32);
      const heldScrollTop = earlyMetrics!.scrollTop;

      await page.waitForTimeout(80);
      const heldAgainMetrics = await readLatestTurnMetrics();
      expect(heldAgainMetrics).not.toBeNull();
      if (heldAgainMetrics!.visibleGap > 32) {
        expect(heldAgainMetrics!.scrollTop).toBeCloseTo(heldScrollTop, 1);
      }

      await expect(page.locator(".assistant-message").last()).toContainText("const state = replay", {
        timeout: 15_000,
      });
      const finalMetrics = await readLatestTurnMetrics();
      expect(finalMetrics).not.toBeNull();
      expect(finalMetrics!.visibleGap).toBeLessThanOrEqual(28);
      expect(finalMetrics!.scrollTop).toBeGreaterThan(heldScrollTop);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("anchors latest submitted prompt near the top when the assistant starts", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 8,
      deterministicThinkingDelayMs: 2_000,
      startApp: true,
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.clear();
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({
            mockDataEnabled: false,
            modelResponseMode: "thinking",
          })
        );
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `Initial scroll anchor setup ${Date.now()} explain Event Sourcing with details`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toContainText("Event Sourcing", {
        timeout: 30_000,
      });

      await page.locator(".chat-transcript").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });

      await fillPrompt(page, "Second prompt should anchor near top while the Event Sourcing answer starts");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });
      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 30_000,
      });

      const readLatestTurnMetrics = () =>
        page.locator(".qa-item").last().evaluate((item) => {
          const transcript = item.closest(".chat-transcript");
          const userTurn = item.querySelector("[data-prompt-response-id]");
          const assistantMessage = item.querySelector(".assistant-message");
          if (!transcript || !userTurn || !assistantMessage) return null;
          const transcriptRect = transcript.getBoundingClientRect();
          const userTurnRect = userTurn.getBoundingClientRect();
          const assistantRect = assistantMessage.getBoundingClientRect();
          return {
            promptTop: userTurnRect.top - transcriptRect.top,
            promptBottom: userTurnRect.bottom - transcriptRect.top,
            assistantTop: assistantRect.top - transcriptRect.top,
            transcriptHeight: transcriptRect.height,
          };
        });

      await expect
        .poll(
          async () => {
            const metrics = await readLatestTurnMetrics();
            return Boolean(
              metrics &&
                metrics.promptTop >= -16 &&
                metrics.promptTop <= 300 &&
                metrics.assistantTop > metrics.promptBottom &&
                metrics.assistantTop < metrics.transcriptHeight
            );
          },
          { timeout: 10_000 }
        )
        .toBe(true);

      const latestTurnMetrics = await readLatestTurnMetrics();
      expect(latestTurnMetrics).not.toBeNull();
      expect(latestTurnMetrics!.promptTop).toBeGreaterThanOrEqual(-16);
      expect(latestTurnMetrics!.promptTop).toBeLessThanOrEqual(300);
      expect(latestTurnMetrics!.assistantTop).toBeGreaterThan(latestTurnMetrics!.promptBottom);
      expect(latestTurnMetrics!.assistantTop).toBeLessThan(latestTurnMetrics!.transcriptHeight);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOM-SCROLL-RULES-REBASE-001 tests
  //
  // Verify that the scroll-to-bottom button and viewport position are driven
  // by REAL rendered content, not by scrollHeight / artificial CSS padding.
  // ═══════════════════════════════════════════════════════════════════════════

  test("Test A — scroll-to-bottom button is hidden while thinking and no real answer yet", async ({ page }) => {
    // Rule 3: button must NOT appear because of artificial generation padding
    // or the thinking indicator alone.  It should only appear once real answer
    // content actually overflows the safe viewport.
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicThinkingDelayMs: 1_000,
      startApp: true,
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({ mockDataEnabled: false, modelResponseMode: "thinking" })
        );
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // ── Submit the first prompt ────────────────────────────────────────────
      await fillPrompt(page, `scroll-rules-a-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();

      // ── Wait for thinking to start (no answer text yet) ───────────────────
      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 30_000,
      });

      // ── Assertions during thinking phase ─────────────────────────────────
      // 1. Loom header (conversation title) must be visible.
      await expect(page.locator(".conversation-context-title-row h1")).toBeVisible();

      // 2. The submitted user prompt text must be visible.
      await expect(page.locator(".qa-item").last().locator(".user-message")).toBeVisible();

      // 3. Thinking indicator must be visible.
      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible();

      // 4. Scroll-to-bottom button must NOT be visible.
      //    It would appear falsely if scrollHeight-based logic counted the
      //    320-560 px CSS padding-bottom as real content overflow.
      await expect(page.locator(".scroll-to-bottom-button")).not.toBeVisible();

      // 5. scrollTop must be 0 (top-lock: all content fits, no anchor scroll).
      //    Before the fit-content guard, the anchor scroll would move scrollTop
      //    to ~(header height - 24 px) ≈ 26, hiding the Loom header above the
      //    viewport.  With the guard active, the transcript stays at position 0.
      const scrollTop = await page.locator(".chat-transcript").evaluate(
        (el) => (el as HTMLElement).scrollTop
      );
      expect(scrollTop).toBeLessThan(8);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("Test B — Loom header stays visible after submit on a short / new Loom", async ({ page }) => {
    // Rule A: when all real content fits the safe viewport, no anchor scroll
    // should hide the Loom header.  The transcript scrollTop must remain 0 and
    // the header h1 must be fully visible inside the transcript bounds.
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicThinkingDelayMs: 800,
      startApp: true,
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({ mockDataEnabled: false, modelResponseMode: "thinking" })
        );
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `toplock-header-b-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();

      // Wait for thinking indicator — header must stay visible throughout.
      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 30_000,
      });

      // Header h1 must be visible and within the transcript visible area.
      await expect(page.locator(".conversation-context-title-row h1")).toBeVisible();

      // scrollTop must be 0: the top-lock guard must have blocked the anchor scroll
      // that would otherwise scroll the header (which lives inside the transcript)
      // above the visible area.
      const scrollTop = await page.locator(".chat-transcript").evaluate(
        (el) => (el as HTMLElement).scrollTop
      );
      expect(scrollTop).toBeLessThan(8);

      // The header must be within the transcript's visible bounding rect.
      const headerInViewport = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>(".conversation-context-title-row h1");
        const transcript = document.querySelector<HTMLElement>(".chat-transcript");
        if (!header || !transcript) return null;
        const headerRect = header.getBoundingClientRect();
        const transcriptRect = transcript.getBoundingClientRect();
        return {
          // top of header relative to transcript top: ≥ 0 means visible
          marginTop: headerRect.top - transcriptRect.top,
        };
      });
      expect(headerInViewport).not.toBeNull();
      // Header top must be within the transcript (no scrolled-off negative margin).
      expect(headerInViewport!.marginTop).toBeGreaterThanOrEqual(-4);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("Test D — final response tail is visible above composer after completion", async ({ page }) => {
    // Rule 5: when the response completes the final real content end must be
    // visible (not scrolled below the composer or hidden in artificial padding).
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 4,
      deterministicThinkingDelayMs: 200,
      startApp: true,
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({ mockDataEnabled: false, modelResponseMode: "thinking" })
        );
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `scroll-rules-d-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();

      // Wait for generation to fully complete.
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Event Sourcing",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(
        /is-generating-response/,
        { timeout: 15_000 }
      );

      // After completion, the real content end (data-transcript-content-end)
      // must be within the safe viewport.  This marker sits after the
      // reference-strip (copy / bookmark) that appears only at completion, so
      // checking it is stricter than checking [data-response-tail] alone.
      const visibility = await page.evaluate(() => {
        const contentEnd = document.querySelector<HTMLElement>(
          "[data-transcript-content-end]"
        );
        const composer = document.querySelector<HTMLElement>(
          ".prompt-composer.active:not(.centered)[data-testid='prompt-composer']"
        );
        const transcript = document.querySelector<HTMLElement>(".chat-transcript");
        if (!contentEnd || !composer || !transcript) return null;
        const contentEndRect = contentEnd.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const transcriptRect = transcript.getBoundingClientRect();
        const safeBottom = Math.min(transcriptRect.bottom, composerRect.top);
        return {
          contentEndBottom: contentEndRect.bottom,
          safeBottom,
          // Positive means content end is above safe bottom (visible); negative means hidden
          margin: safeBottom - contentEndRect.bottom,
        };
      });

      expect(visibility).not.toBeNull();
      // Content end must be AT or above the safe bottom — allow 20 px tolerance
      // for layout rounding and the 16 px gap used by scrollRealContentEndIntoSafeView.
      expect(visibility!.margin).toBeGreaterThanOrEqual(-20);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("Test F — scroll-to-bottom button appears only when real content overflows and click reveals content end", async ({ page }) => {
    // Rule 3 & 6: button visible ↔ real content below safe viewport;
    // clicking it reveals the real content end (not artificial padding bottom).
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 4,
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // Build two completed responses so the transcript is scrollable.
      for (const seed of [
        `scroll-rules-f1-${Date.now()} event sourcing detay`,
        `scroll-rules-f2-${Date.now()} compaction event sourcing`,
      ]) {
        await fillPrompt(page, seed);
        await page.getByRole("button", { name: "Send" }).click();
        await expect(page.locator(".assistant-message").last()).toBeVisible({ timeout: 30_000 });
        await expect(page.locator(".chat-transcript")).not.toHaveClass(
          /is-generating-response/,
          { timeout: 15_000 }
        );
      }

      // Scroll to the top to put real content below the viewport.
      await page.locator(".chat-transcript").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.waitForTimeout(60); // let rAF fire

      // The scroll-to-bottom button should now be visible.
      await expect(page.locator(".scroll-to-bottom-button")).toBeVisible({ timeout: 5_000 });

      // Click it and verify the real content end is now visible.
      await page.locator(".scroll-to-bottom-button").click();
      await page.waitForTimeout(500); // allow smooth scroll to settle

      const afterClick = await page.evaluate(() => {
        const marker = document.querySelector<HTMLElement>("[data-transcript-content-end]");
        const composer = document.querySelector<HTMLElement>(
          ".prompt-composer.active:not(.centered)[data-testid='prompt-composer']"
        );
        const transcript = document.querySelector<HTMLElement>(".chat-transcript");
        if (!marker || !composer || !transcript) return null;
        const markerRect = marker.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const transcriptRect = transcript.getBoundingClientRect();
        const safeBottom = Math.min(transcriptRect.bottom, composerRect.top);
        return {
          markerBottom: markerRect.bottom,
          safeBottom,
          // Positive = marker is above safe bottom (visible); negative = hidden
          margin: safeBottom - markerRect.bottom,
        };
      });

      expect(afterClick).not.toBeNull();
      // Content end must be at or above the safe bottom (visible) after clicking.
      expect(afterClick!.margin).toBeGreaterThanOrEqual(-8);

      // Button should now be hidden (we're at the real content end).
      await expect(page.locator(".scroll-to-bottom-button")).not.toBeVisible();
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });
});
