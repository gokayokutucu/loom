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

async function waitForWeftTitles(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  expectedTitles: string[]
) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const looms = await scenario.client.listLooms();
    const wefts = looms.filter((loom) => loom.kind === "weft");
    const titles = wefts.map((loom) => loom.title);
    if (
      wefts.length === expectedTitles.length &&
      expectedTitles.every((title) => titles.includes(title))
    ) {
      return wefts;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Weft titles: ${expectedTitles.join(", ")}`);
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
    const createWeftRequestBodies: unknown[] = [];

    try {
      await page.route(/\/wefts$/, async (route) => {
        createWeftRequests += 1;
        createWeftRequestBodies.push(route.request().postDataJSON());
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
        .getByRole("button", { name: /Focus temporary Flow from/i })
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
      expect(createWeftRequestBodies[0]).toMatchObject({
        initialPrompt: "Bunu maliyet açısından değerlendir.",
      });
      expect(persistedWefts[0]).toMatchObject({
        kind: "weft",
        weftKind: "exploration",
      });
      await waitForWeftTitles(scenario, ["Loom: Bunu maliyet açısından değerlendir."]);
      await expect(
        weftPanel.locator(".qa-item").getByText("Bunu maliyet açısından değerlendir.", {
          exact: true,
        })
      ).toBeVisible({
        timeout: 30_000,
      });
      await expect(weftPanel.locator(".qa-item")).not.toContainText(
        "Event Sourcing AWS üzerinde nasıl kurgulanır?"
      );
      await expect(addressBar).toHaveAttribute("placeholder", /Loom:/);

      await page.locator(".origin-split-panel").click({ position: { x: 40, y: 40 } });
      await expect(addressBar).toHaveAttribute("placeholder", /Event Sourcing|AWS/i);
      await expect(addressBar).not.toHaveAttribute("placeholder", /temp-weft|temporary-weft/i);
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

      await waitForWeftCount(scenario, 2);
      expect(createWeftRequests).toBe(2);
      expect(createWeftRequestBodies[1]).toMatchObject({
        initialPrompt: "İkinci olasılığı güvenlik açısından değerlendir.",
      });
      await waitForWeftTitles(scenario, [
        "Loom: Bunu maliyet açısından değerlendir.",
        "Loom: İkinci olasılığı güvenlik açısından değerlendir.",
      ]);
      await expect(page.locator(".origin-split-panel .prompt-revision-action-counter")).toHaveCount(0);
      const originWeftButton = page.locator(".origin-split-panel .response-weft-chip").first();
      const originWeftCountTrigger = page
        .locator(".origin-split-panel .response-weft-action-cluster")
        .first()
        .locator(".response-weft-count-trigger");
      await expect(originWeftCountTrigger).toContainText("2");
      await expect(originWeftButton).toHaveClass(/is-wefted/);
      await expect(originWeftButton).toHaveAttribute(
        "aria-pressed",
        "true"
      );

      await originWeftCountTrigger.click();
      await expect(page.getByRole("menu", { name: "Weft branches" })).toBeVisible();
      await originWeftCountTrigger.click();
      await expect(page.getByRole("menu", { name: "Weft branches" })).toHaveCount(0);

      await originWeftButton.click();
      const originWeftPicker = page.getByRole("menu", { name: "Weft branches" });
      await expect(originWeftPicker).toBeVisible();
      await expect(originWeftPicker.getByRole("menuitem")).toHaveCount(2);
      await expect(originWeftPicker).not.toContainText("Revision:");
      await originWeftButton.click();
      await expect(page.getByRole("menu", { name: "Weft branches" })).toHaveCount(0);

      const weftButtonBox = await originWeftButton.boundingBox();
      expect(weftButtonBox).toBeTruthy();
      await page.mouse.move(
        weftButtonBox!.x + weftButtonBox!.width / 2,
        weftButtonBox!.y + weftButtonBox!.height / 2
      );
      await page.mouse.down();
      await page.waitForTimeout(500);
      await page.mouse.up();
      await page.getByRole("menu", { name: "Weft branches" }).getByRole("menuitem").first().click();
      await expect(page.locator(".weft-split-panel")).toContainText("maliyet");
      await expect(page.locator(".weft-split-panel")).not.toContainText("güvenlik");

      await page.getByRole("button", { name: /Open Event Sourcing AWS/i }).first().click();
      await page.getByRole("button", { name: "Toggle Graph View" }).click();
      const graphResponseNode = page
        .locator(".loom-graph-node--response", { has: page.locator(".weft-count-badge") })
        .first();
      await expect(graphResponseNode).toBeVisible();
      await graphResponseNode.click();
      const graphPreview = page.locator(".graph-response-preview-modal");
      await expect(graphPreview).toBeVisible();
      await graphPreview.getByRole("button", { name: /Open Weft list from/i }).click();
      const graphWeftPicker = graphPreview.getByRole("menu", { name: "Weft branches" });
      await expect(graphWeftPicker).toBeVisible();
      await expect(graphWeftPicker.getByRole("menuitem")).toHaveCount(2);
      await expect(graphWeftPicker).not.toContainText("Revision:");
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});
