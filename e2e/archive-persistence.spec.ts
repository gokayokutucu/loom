// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
// - Test data is created through the product composer and cleaned up by the harness.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function sendPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("[product-service-backed] Archive persistence", () => {
  test("archived Loom stays archived after app reload", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const prompt = `Archive persistence proof ${Date.now()}`;
      await sendPrompt(page, prompt);
      await expect(page.getByText("Event Sourcing").first()).toBeVisible({
        timeout: 30_000,
      });

      const created = (await scenario.client.listLooms()).find((loom) =>
        loom.title.includes("Archive persistence proof")
      );
      expect(created).toBeTruthy();

      await page.getByTestId(`sidebar-loom-${created!.loomId}`).hover();
      await page.getByRole("button", { name: `Archive ${created!.title}` }).click();
      await expect(page.getByRole("button", { name: `Open ${created!.title}` })).toHaveCount(0);

      await expect.poll(async () => scenario.client.listLooms()).toHaveLength(0);
      const archived = await scenario.client.listLooms({ archived: true });
      expect(archived.map((loom) => loom.loomId)).toContain(created!.loomId);

      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await expect(page.getByRole("button", { name: `Open ${created!.title}` })).toHaveCount(0);

      await page.getByRole("button", { name: "Open Archive" }).click();
      await expect(page.getByRole("button", { name: `Restore ${created!.title}` })).toBeVisible();
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});
