// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function waitForWeftCount(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  expectedCount: number
) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const looms = await scenario.client.listLooms();
    const wefts = looms.filter((loom) => loom.kind === "weft");
    if (wefts.length === expectedCount) return wefts;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${expectedCount} persisted Wefts.`);
}

test.describe("[product-service-backed] Temporary Weft workspace", () => {
  test("opens a temporary workspace on Weft click and persists only after first prompt", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    let createWeftRequests = 0;

    try {
      await page.route(/\/wefts$/, async (route) => {
        createWeftRequests += 1;
        await route.continue();
      });
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendMainPrompt(page, "Event Sourcing AWS üzerinde nasıl kurgulanır?");
      await expect(page.getByText("Deterministic E2E provider").first()).toBeVisible({
        timeout: 30_000,
      });
      const addressBar = page.getByLabel("Loom Address Bar");
      const originAddressPlaceholder = await addressBar.getAttribute("placeholder");
      expect(originAddressPlaceholder).toMatch(/Event Sourcing|AWS/i);
      await expect(page.getByRole("button", { name: /Start Weft from/i })).toBeVisible();
      expect(await waitForWeftCount(scenario, 0)).toEqual([]);

      await page.getByRole("button", { name: /Start Weft from/i }).first().click();
      await expect(page.locator(".weft-split-view")).toBeVisible();
      await expect(page.locator(".weft-split-panel")).toBeVisible();
      await page.locator(".weft-split-panel").click({ position: { x: 40, y: 40 } });
      await expect(addressBar).toHaveAttribute("placeholder", originAddressPlaceholder ?? "");
      await expect(addressBar).not.toHaveAttribute("placeholder", /temp-weft|temporary-weft/i);
      expect(createWeftRequests).toBe(0);
      expect(await waitForWeftCount(scenario, 0)).toEqual([]);
      await expect(page.locator(".loom-graph-node--weft")).toHaveCount(0);

      await page
        .locator(".origin-split-panel")
        .getByRole("button", { name: /Start Weft from/i })
        .first()
        .click();
      expect(createWeftRequests).toBe(0);
      expect(await waitForWeftCount(scenario, 0)).toEqual([]);

      const weftPanel = page.locator(".weft-split-panel");
      const weftEditor = weftPanel.getByRole("textbox", { name: "Prompt" });
      await expect(weftEditor).toBeFocused();
      await page.keyboard.insertText("Bunu maliyet açısından değerlendir.");
      await weftPanel.getByRole("button", { name: "Send" }).click();

      const persistedWefts = await waitForWeftCount(scenario, 1);
      expect(createWeftRequests).toBe(1);
      expect(persistedWefts[0]).toMatchObject({
        kind: "weft",
        weftKind: "exploration",
      });
      await expect(weftPanel.getByText("maliyet", { exact: false })).toBeVisible({
        timeout: 30_000,
      });
      await expect(addressBar).toHaveAttribute("placeholder", /Loom:/);

      await page.locator(".origin-split-panel").click({ position: { x: 40, y: 40 } });
      await expect(addressBar).toHaveAttribute("placeholder", originAddressPlaceholder ?? "");
      await page.locator(".weft-split-panel").click({ position: { x: 40, y: 40 } });
      await expect(addressBar).toHaveAttribute("placeholder", /Loom:/);

      await page
        .locator(".origin-split-panel")
        .getByRole("button", { name: /Open Weft from/i })
        .first()
        .click();
      expect(createWeftRequests).toBe(1);

      await page.getByRole("button", { name: "Close Flow panel" }).click();
      await expect(page.locator(".weft-split-view")).toHaveCount(0);

      await page.getByRole("button", { name: /Open Weft from/i }).first().click();
      await expect(page.locator(".weft-split-view")).toBeVisible();
      expect(createWeftRequests).toBe(1);
      await page
        .locator(".weft-split-panel")
        .getByRole("textbox", { name: "Prompt" })
        .click();
      await page.keyboard.insertText("İkinci olasılığı güvenlik açısından değerlendir.");
      await page.locator(".weft-split-panel").getByRole("button", { name: "Send" }).click();

      const twoPersistedWefts = await waitForWeftCount(scenario, 2);
      expect(createWeftRequests).toBe(2);
      const originCounter = page.locator(".origin-split-panel .response-weft-branch-counter").first();
      await expect(originCounter).toContainText("/2");
      await expect(page.locator(".origin-split-panel .response-weft-chip")).toHaveClass(/is-wefted/);
      await expect(page.locator(".origin-split-panel .response-weft-chip")).toHaveAttribute(
        "aria-pressed",
        "true"
      );

      await originCounter.getByRole("button", { name: "Previous Weft branch" }).click();
      await expect(page.locator(".weft-split-panel")).toContainText("maliyet");
      await expect(page.locator(".weft-split-panel")).not.toContainText("güvenlik");
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});
