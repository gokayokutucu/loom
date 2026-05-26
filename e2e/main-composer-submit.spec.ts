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
});
