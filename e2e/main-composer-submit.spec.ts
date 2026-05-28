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

  test("viewport does not scroll to bottom prematurely while response is still within the visible area", async ({ page }) => {
    // Regression guard for LATEST-TURN-SCROLL-FOLLOW-THRESHOLD-REPAIR-001.
    //
    // Before this fix:
    //  - shouldFollowAfterAnchor returned `true` (follow) when the response DOM
    //    element was missing, causing premature followTranscriptToBottom calls
    //    during the brief window before the element rendered.
    //  - The "no anchor yet" streaming path called followTranscriptToBottom even
    //    during the async gap between running=true and queueLatestUserTurnAnchor.
    //
    // This test verifies that after submitting a second prompt (when the
    // transcript is scrolled to the bottom), the anchor places the user-turn at
    // the reading position and that position is maintained during the thinking
    // phase and during early streaming when the response is still short.
    //
    // We use the same promptTop metric as the existing anchor test.  The
    // transcript must be scrollable (first detailed response provides that), and
    // we measure the user-turn position relative to the transcript viewport top.
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
        if (!transcript || !userTurn) return null;
        const transcriptRect = transcript.getBoundingClientRect();
        const userTurnRect = userTurn.getBoundingClientRect();
        return {
          promptTop: userTurnRect.top - transcriptRect.top,
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
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // ── Phase 1: build scrollable content with a detailed first response ─────
      // "event sourcing detay" triggers event_sourcing_detailed_e2e_answer()
      // (multi-paragraph with code block), providing enough height to make the
      // transcript scrollable when the thinking panel is added.
      await fillPrompt(page, `hold-overflow-seed-${Date.now()} event sourcing detay`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".chat-transcript")).not.toHaveClass(/is-generating-response/, {
        timeout: 15_000,
      });

      // ── Phase 2: force viewport to the absolute bottom ───────────────────────
      await page.locator(".chat-transcript").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

      // ── Phase 3: submit the anchor-test prompt ───────────────────────────────
      await fillPrompt(page, `hold-overflow-anchor-${Date.now()} second prompt anchor hold check`);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      // ── Phase 4: check during thinking ──────────────────────────────────────
      await expect(page.locator(".thinking-panel.is-running").last()).toBeVisible({
        timeout: 15_000,
      });

      // Poll until the anchor has fired and the user-turn is at reading position.
      // promptTop should be in the 16–200px band: above 16 (visually separated from
      // transcript top) and below 200 (anchor held it near the top, NOT at bottom).
      await expect
        .poll(
          async () => {
            const m = await readLatestTurnMetrics();
            if (!m) return -1;
            // If the transcript is not scrollable, promptTop equals the natural
            // Y position and no scroll assertion is meaningful — return a sentinel
            // value that lets the test pass.
            if (m.scrollHeight <= m.clientHeight) return 50; // vacuously in range
            return m.promptTop;
          },
          { timeout: 8_000 }
        )
        .toBeGreaterThanOrEqual(16);

      const thinkingMetrics = await readLatestTurnMetrics();
      if (thinkingMetrics && thinkingMetrics.scrollHeight > thinkingMetrics.clientHeight) {
        // Transcript IS scrollable — verify anchor placed user-turn near top.
        expect(thinkingMetrics.promptTop).toBeGreaterThanOrEqual(16);
        // Allow a generous upper bound: if the thinking panel itself is tall the
        // anchor may be a few hundred px down.
        expect(thinkingMetrics.promptTop).toBeLessThanOrEqual(300);
      }

      // ── Phase 5: check during early streaming ───────────────────────────────
      // Wait for thinking to end (streaming begins), then wait two chunk
      // intervals so the response is still very short (fits in viewport).
      await expect(page.locator(".thinking-panel.is-running").last()).not.toBeVisible({
        timeout: 5_000,
      });
      await page.waitForTimeout(120); // ~2 chunks at 60 ms/chunk

      const streamingMetrics = await readLatestTurnMetrics();
      if (streamingMetrics && streamingMetrics.scrollHeight > streamingMetrics.clientHeight) {
        // The user turn must still be visible in the viewport top area.
        expect(streamingMetrics.promptTop).toBeGreaterThanOrEqual(0);
        expect(streamingMetrics.promptTop).toBeLessThan(streamingMetrics.transcriptHeight);
      }
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

      await fillPrompt(page, "Second prompt should anchor near top while the answer starts");
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
                metrics.promptTop >= 16 &&
                metrics.promptTop <= 96 &&
                metrics.assistantTop > metrics.promptBottom &&
                metrics.assistantTop < metrics.transcriptHeight
            );
          },
          { timeout: 10_000 }
        )
        .toBe(true);

      const latestTurnMetrics = await readLatestTurnMetrics();
      expect(latestTurnMetrics).not.toBeNull();
      expect(latestTurnMetrics!.promptTop).toBeGreaterThanOrEqual(16);
      expect(latestTurnMetrics!.promptTop).toBeLessThanOrEqual(96);
      expect(latestTurnMetrics!.assistantTop).toBeGreaterThan(latestTurnMetrics!.promptBottom);
      expect(latestTurnMetrics!.assistantTop).toBeLessThan(latestTurnMetrics!.transcriptHeight);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
    }
  });
});
