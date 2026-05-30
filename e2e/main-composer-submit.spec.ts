// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
// - Test data is created through the product composer and cleaned up by the harness.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

const LONG_STREAMING_FIXTURE_MARKER = "END_OF_LONG_STREAMING_FIXTURE";
const LONG_STREAMING_FIXTURE_PROMPT = "long streaming scroll fixture";
const LONG_USER_PROMPT = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed nulla risus, porttitor at dignissim nec, posuere vel justo. Quisque augue felis, elementum vehicula blandit vel, porta vel enim. Nulla at libero tempor, laoreet risus sed, porta nisi. Fusce ultrices laoreet tempus. Duis euismod dui eu nunc aliquam suscipit. Nullam hendrerit pellentesque ex. In lobortis neque justo, eget convallis ante sollicitudin id. In placerat sit amet leo sed porttitor. Maecenas et libero id neque elementum ultrices et sit amet eros.",
  "Vivamus diam arcu, commodo imperdiet congue vitae, imperdiet in eros. Duis vitae dui luctus, fermentum enim eu, auctor libero. Nulla ipsum lorem, dapibus ut ultricies at, auctor id mi. Ut imperdiet metus eu sem posuere, ac varius ante vestibulum. Pellentesque quis velit a felis pellentesque ultricies pulvinar eget felis. Nam varius leo a risus consequat pellentesque. Ut consectetur nisi dui, quis eleifend tellus mollis tristique. Proin non cursus ante. Integer vitae vestibulum diam.",
  'Aenean consectetur tellus tempor tincidunt imperdiet. Nam rutrum tortor id maximus varius. Nullam lorem velit, placerat quis pulvinar hendrerit, bibendum eget magna. Please ignore the lorem ipsum passage. I would like to know more about prefrontal cortex.',
].join("\n\n");

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

  test("long streaming fixture produces progressive overflow and final marker", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "word",
      deterministicThinkingDelayMs: 300,
      deterministicStreamChunkDelayMs: 10,
      startApp: true,
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({ mockDataEnabled: false, modelResponseMode: "thinking" })
        );
      });
      await page.setViewportSize({ width: 500, height: 784 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `${LONG_STREAMING_FIXTURE_PROMPT} progressive ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Long Streaming Scroll Fixture",
        { timeout: 30_000 }
      );

      const firstLength = await page
        .locator(".assistant-message")
        .last()
        .innerText()
        .then((text) => text.length);
      await expect
        .poll(
          async () => {
            const text = await page.locator(".assistant-message").last().innerText();
            return text.length;
          },
          { timeout: 10_000 }
        )
        .toBeGreaterThan(firstLength + 200);

      await expect(page.locator(".assistant-message").last()).toContainText(
        LONG_STREAMING_FIXTURE_MARKER,
        { timeout: 30_000 }
      );

      const overflowState = await page.evaluate(() => {
        const assistant = document.querySelector<HTMLElement>(".assistant-message");
        const transcript = document.querySelector<HTMLElement>(".chat-transcript");
        const composer = document.querySelector<HTMLElement>(
          ".prompt-composer.active:not(.centered)[data-testid='prompt-composer']"
        );
        if (!assistant || !transcript || !composer) return null;
        const assistantRect = assistant.getBoundingClientRect();
        const transcriptRect = transcript.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const safeHeight = Math.min(transcriptRect.bottom, composerRect.top) - transcriptRect.top;
        return {
          assistantHeight: assistantRect.height,
          safeHeight,
          scrollable: transcript.scrollHeight > transcript.clientHeight + 40,
        };
      });
      expect(overflowState).not.toBeNull();
      expect(overflowState!.assistantHeight).toBeGreaterThan(overflowState!.safeHeight * 0.6);
      expect(overflowState!.scrollable).toBe(true);

      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 15_000,
      });
      await page.waitForTimeout(1_000);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("long submitted prompt stays collapsed while service streaming starts", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "word",
      deterministicThinkingDelayMs: 300,
      deterministicStreamChunkDelayMs: 10,
      startApp: true,
    });

    const readPromptMetrics = () =>
      page.locator(".qa-item").last().evaluate((item) => {
        const transcript = item.closest<HTMLElement>(".chat-transcript");
        const promptText = item.querySelector<HTMLElement>(".user-message-prompt-text");
        const collapsible = item.querySelector<HTMLElement>(".user-message-collapsible");
        const assistant = item.querySelector<HTMLElement>(".assistant-message");
        if (!transcript || !promptText || !collapsible || !assistant) return null;
        const transcriptRect = transcript.getBoundingClientRect();
        const promptRect = promptText.getBoundingClientRect();
        const assistantRect = assistant.getBoundingClientRect();
        const style = getComputedStyle(promptText);
        const lineHeight = Number.parseFloat(style.lineHeight);
        return {
          expanded: collapsible.dataset.expanded,
          isClamped: promptText.classList.contains("is-clamped"),
          collapseLines: style.getPropertyValue("--user-message-collapse-lines").trim(),
          promptHeight: promptRect.height,
          maxCollapsedHeight: lineHeight * 10 + 8,
          promptTop: promptRect.top - transcriptRect.top,
          promptBottom: promptRect.bottom - transcriptRect.top,
          assistantTop: assistantRect.top - transcriptRect.top,
          transcriptHeight: transcriptRect.height,
        };
      });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({ mockDataEnabled: false, modelResponseMode: "thinking" })
        );
      });
      await page.setViewportSize({ width: 500, height: 784 });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `${LONG_USER_PROMPT}\n\n${LONG_STREAMING_FIXTURE_PROMPT}`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      await expect
        .poll(
          async () => {
            const metrics = await readPromptMetrics();
            return Boolean(
              metrics &&
                metrics.expanded === "false" &&
                metrics.isClamped &&
                metrics.collapseLines === "10" &&
                metrics.promptHeight <= metrics.maxCollapsedHeight &&
                metrics.promptTop >= -16 &&
                metrics.promptBottom < 360 &&
                metrics.assistantTop > metrics.promptBottom &&
                metrics.assistantTop < metrics.transcriptHeight
            );
          },
          { timeout: 10_000 }
        )
        .toBe(true);

      await expect(page.locator(".assistant-message").last()).toContainText(
        "Long Streaming Scroll Fixture",
        { timeout: 30_000 }
      );

      const streamingMetrics = await readPromptMetrics();
      expect(streamingMetrics).not.toBeNull();
      expect(streamingMetrics!.expanded).toBe("false");
      expect(streamingMetrics!.isClamped).toBe(true);
      expect(streamingMetrics!.collapseLines).toBe("10");
      expect(streamingMetrics!.promptHeight).toBeLessThanOrEqual(
        streamingMetrics!.maxCollapsedHeight
      );

      await expect(page.locator(".assistant-message").last()).toContainText(
        LONG_STREAMING_FIXTURE_MARKER,
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 15_000,
      });
      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      const persistedLoomTab = page.locator('[data-testid^="sidebar-loom-"]').first();
      await expect(persistedLoomTab).toBeVisible({ timeout: 30_000 });
      await persistedLoomTab.click();
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });
      const reloadedMetrics = await readPromptMetrics();
      expect(reloadedMetrics).not.toBeNull();
      expect(reloadedMetrics!.expanded).toBe("false");
      expect(reloadedMetrics!.isClamped).toBe(true);
      expect(reloadedMetrics!.collapseLines).toBe("10");
      expect(reloadedMetrics!.promptHeight).toBeLessThanOrEqual(
        reloadedMetrics!.maxCollapsedHeight
      );
      await page.waitForTimeout(500);
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
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "word",
      deterministicStreamChunkDelayMs: 10,
      deterministicThinkingDelayMs: 1_500,
      startApp: true,
    });

    const readLatestTurnMetrics = () =>
      page.locator(".qa-item").last().evaluate((item) => {
        const transcript = item.closest(".chat-transcript");
        const userTurn = item.querySelector<HTMLElement>("[data-prompt-response-id]");
        const tail = item.querySelector<HTMLElement>("[data-response-tail]");
        const contentEnd = document.querySelector<HTMLElement>("[data-transcript-content-end]");
        const composer = document.querySelector<HTMLElement>(
          ".prompt-composer.active:not(.centered)[data-testid='prompt-composer']"
        );
        if (!transcript || !userTurn || !tail || !contentEnd || !composer) return null;
        const transcriptRect = transcript.getBoundingClientRect();
        const userTurnRect = userTurn.getBoundingClientRect();
        const tailRect = tail.getBoundingClientRect();
        const contentEndRect = contentEnd.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const safeBottom = Math.min(transcriptRect.bottom, composerRect.top);
        return {
          promptTop: userTurnRect.top - transcriptRect.top,
          tailBottom: tailRect.bottom,
          composerTop: composerRect.top,
          safeBottom,
          visibleGap: safeBottom - tailRect.bottom,
          contentEndVisibleGap: safeBottom - contentEndRect.bottom,
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

      await fillPrompt(page, `${LONG_STREAMING_FIXTURE_PROMPT} seed ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });

      await page.locator(".chat-transcript").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

      await fillPrompt(page, `${LONG_STREAMING_FIXTURE_PROMPT} anchor ${Date.now()}`);
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

      await expect(page.locator(".assistant-message").last()).toContainText(
        LONG_STREAMING_FIXTURE_MARKER,
        { timeout: 30_000 }
      );
      const finalMetrics = await readLatestTurnMetrics();
      expect(finalMetrics).not.toBeNull();
      expect(finalMetrics!.contentEndVisibleGap).toBeGreaterThanOrEqual(-20);
      expect(finalMetrics!.contentEndVisibleGap).toBeLessThanOrEqual(80);
      expect(finalMetrics!.scrollTop).toBeGreaterThan(heldScrollTop);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("tiny manual scroll pauses streaming follow but completion snaps real content end into view", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "word",
      deterministicStreamChunkDelayMs: 10,
      deterministicThinkingDelayMs: 200,
      startApp: true,
    });

    const readEndMetrics = () =>
      page.evaluate(() => {
        const transcript = document.querySelector<HTMLElement>(".chat-transcript");
        const marker = document.querySelector<HTMLElement>("[data-transcript-content-end]");
        const composer = document.querySelector<HTMLElement>(
          ".prompt-composer.active:not(.centered)[data-testid='prompt-composer']"
        );
        if (!transcript || !marker || !composer) return null;
        const transcriptRect = transcript.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        const safeBottom = Math.min(transcriptRect.bottom, composerRect.top);
        return {
          isGenerating: transcript.classList.contains("is-generating-response"),
          markerBottom: markerRect.bottom,
          safeBottom,
          visibleGap: safeBottom - markerRect.bottom,
          scrollTop: transcript.scrollTop,
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

      await fillPrompt(page, `${LONG_STREAMING_FIXTURE_PROMPT} manual-scroll ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.locator(".assistant-message").last()).toContainText(
        "Fixture setup",
        { timeout: 30_000 }
      );

      await expect
        .poll(
          async () => {
            const metrics = await readEndMetrics();
            return metrics?.scrollTop ?? 0;
          },
          { timeout: 10_000 }
        )
        .toBeGreaterThan(20);

      const beforeManual = await readEndMetrics();
      expect(beforeManual).not.toBeNull();
      await page.locator(".chat-transcript").hover();
      await page.mouse.wheel(0, -32);
      await page.waitForTimeout(120);
      const afterManual = await readEndMetrics();
      expect(afterManual).not.toBeNull();
      expect(afterManual!.scrollTop).toBeLessThanOrEqual(beforeManual!.scrollTop);

      await page.waitForTimeout(700);
      const duringStream = await readEndMetrics();
      expect(duringStream).not.toBeNull();
      if (duringStream!.isGenerating) {
        expect(duringStream!.scrollTop).toBeLessThanOrEqual(afterManual!.scrollTop + 24);
      }

      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });
      await page.waitForTimeout(700);

      const completed = await readEndMetrics();
      expect(completed).not.toBeNull();
      expect(completed!.visibleGap).toBeGreaterThanOrEqual(-20);
      expect(completed!.visibleGap).toBeLessThanOrEqual(80);
      expect(completed!.scrollTop).toBeGreaterThan(afterManual!.scrollTop);
      await page.waitForTimeout(1_000);
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
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "phrase",
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

      await fillPrompt(page, `${LONG_STREAMING_FIXTURE_PROMPT} initial ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toContainText(
        LONG_STREAMING_FIXTURE_MARKER,
        { timeout: 30_000 }
      );

      await page.locator(".chat-transcript").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });

      await fillPrompt(page, `${LONG_STREAMING_FIXTURE_PROMPT} second anchor ${Date.now()}`);
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
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 30_000,
      });
      await page.waitForTimeout(1_000);
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
      deterministicResponseMode: "long-streaming-scroll",
      deterministicChunkMode: "phrase",
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

      await fillPrompt(page, `${LONG_STREAMING_FIXTURE_PROMPT} final-tail ${Date.now()}`);
      await page.getByRole("button", { name: "Send" }).click();

      // Wait for generation to fully complete.
      await expect(page.locator(".assistant-message").last()).toContainText(
        LONG_STREAMING_FIXTURE_MARKER,
        { timeout: 30_000 }
      );
      await expect(page.getByText(LONG_STREAMING_FIXTURE_MARKER).last()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.locator(".chat-transcript")).not.toHaveClass(
        /is-generating-response/,
        { timeout: 15_000 }
      );

      // After completion, the real content end (data-transcript-content-end)
      // must be within the safe viewport.  This marker sits after the
      // reference-strip (copy / bookmark) that appears only at completion, so
      // checking it is stricter than checking [data-response-tail] alone.
      // Content end must be AT or above the safe bottom — allow 20 px tolerance
      // for layout rounding and the 16 px gap used by scrollRealContentEndIntoSafeView.
      await expect
        .poll(
          async () => {
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
            return visibility?.margin ?? -999;
          },
          { timeout: 5_000 }
        )
        .toBeGreaterThanOrEqual(-20);
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
      deterministicResponseMode: "long-streaming-scroll",
      deterministicStreamChunkDelayMs: 0,
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // Build two completed responses so the transcript is scrollable.
      for (const seed of [
        `${LONG_STREAMING_FIXTURE_PROMPT} scroll-button-one ${Date.now()}`,
        `${LONG_STREAMING_FIXTURE_PROMPT} scroll-button-two ${Date.now()}`,
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

      // Content end must be at or above the safe bottom (visible) after clicking.
      await expect
        .poll(
          async () => {
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
            return afterClick?.margin ?? -999;
          },
          { timeout: 5_000 }
        )
        .toBeGreaterThanOrEqual(-8);

      // Button should now be hidden (we're at the real content end).
      await expect(page.locator(".scroll-to-bottom-button")).not.toBeVisible();
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("Test G — Stop button is visible while the service is streaming a response", async ({ page }) => {
    // Generation lifecycle: composerRuntimeState.running must be true during the
    // whole streaming window so the send button shows a Stop icon.
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicStreamChunkDelayMs: 8,
      deterministicThinkingDelayMs: 400,
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

      await fillPrompt(page, `stop-button-g-${Date.now()} event sourcing`);
      await page.getByRole("button", { name: "Send" }).click();

      // The send button must become the Stop button within a short time.
      await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({
        timeout: 10_000,
      });

      // It must stay visible while thinking is running.
      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();

      // Wait for completion — the Stop button must revert to Send.
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Event Sourcing",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(
        /is-generating-response/,
        { timeout: 15_000 }
      );
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 5_000 });
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("Test H — Retry shows thinking panel immediately and Stop button during streaming", async ({ page }) => {
    // Generation lifecycle: executeRetryFromUserMessage must set
    // composerRuntimeTargetKey and clear stale thinking state so the thinking
    // panel is visible from the moment retry starts, not only after the first
    // thinking_status event.
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      deterministicThinkingDelayMs: 800,
      deterministicStreamChunkDelayMs: 8,
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

      // Submit once and wait for the response to complete.
      await fillPrompt(page, `retry-thinking-h-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Event Sourcing",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(
        /is-generating-response/,
        { timeout: 15_000 }
      );

      // The retry button lives inside the user-turn container whose z-index
      // layer intercepts Playwright's synthesised pointer events during a
      // standard hover() actionability check.  force:true bypasses the
      // interception check and delivers the click directly to the element.
      const retryTrigger = page.locator(".prompt-retry-trigger").last();
      await retryTrigger.waitFor({ state: "attached", timeout: 5_000 });
      await retryTrigger.click({ force: true });

      // The thinking panel must appear within 3 seconds of clicking Retry —
      // before the first thinking_status event arrives from the service.
      await expect(page.locator(".thinking-panel").last()).toBeVisible({ timeout: 3_000 });

      // The Stop button must also be visible during the retry stream.
      await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({
        timeout: 5_000,
      });

      // Wait for retry to complete.
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Event Sourcing",
        { timeout: 30_000 }
      );
      await expect(page.locator(".chat-transcript")).not.toHaveClass(
        /is-generating-response/,
        { timeout: 15_000 }
      );
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });

  test("Test I — reload mid-stream: Stop button reappears after page reload", async ({ page }) => {
    // Generation lifecycle: after a page reload while the service is still
    // streaming, the polling path (applyGenerationResponseState) must sync
    // composerRuntimeState.running back to true so the Stop button reappears
    // and scroll-follow resumes on the active loom.
    //
    // Scope: this test only asserts lifecycle-state recovery (running flag,
    // Stop button, active loom navigation).  It does NOT assert that streamed
    // content is delivered after reload because the deterministic test service
    // may abandon/stall the workflow when the SSE connection is severed on
    // reload — the product does not currently guarantee post-disconnect
    // content delivery.
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      // Keep the thinking phase alive long enough that a reload lands while
      // the workflow is still in the thinking stage and registered as live.
      deterministicThinkingDelayMs: 3_000,
      startApp: true,
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "loom-ai-app-settings-v1",
          JSON.stringify({
            mockDataEnabled: false,
            modelResponseMode: "thinking",
            // Auto-navigate back to the last active Loom on reload so the
            // Stop button can appear for the correct composer.
            startup: { continueFromLastLoom: true },
          })
        );
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await fillPrompt(page, `reload-recovery-i-${Date.now()} event sourcing`);
      await page.getByRole("button", { name: "Send" }).click();

      // Wait for the thinking phase so we know the workflow is live and
      // registered in the DB before reloading.
      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 10_000,
      });

      // Reload the page while the workflow is still in the thinking stage.
      await page.reload();

      // After reload the app should:
      //   1. Auto-navigate back to the streaming Loom (continueFromLastLoom)
      //   2. Detect the live workflow via liveServiceGenerationRunIds polling
      //   3. Restore composerRuntimeState.running = true via applyGenerationResponseState
      // The Stop button must become visible within the polling interval (≤ 3 s).
      await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible({
        timeout: 10_000,
      });

      // The active Loom must be the one that was streaming.
      await expect(page.locator(".chat-transcript")).toBeVisible();

      // Clicking Stop from the recovered state must clear the running flag and
      // restore the Send button — proves the lifecycle round-trip is clean.
      await page.getByRole("button", { name: "Stop response" }).click();
      await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 10_000 });
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });
});
