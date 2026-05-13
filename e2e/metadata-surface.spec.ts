// E2E data authority classification: PURE_UI_RENDERING.
// This spec validates metadata display behavior over seeded UI state, not product runtime authority.
import { expect, type Page, test } from "@playwright/test";

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openArchitectureLoom(page: Page) {
  await page.getByTestId("sidebar-pinned-loom-c-architecture").click();
  await expect(page.locator(".conversation-context h1").first()).toHaveText(
    "Loom AI navigation architecture"
  );
}

test.describe("[pure-ui-rendering] Loom metadata surface", () => {
  test("Loom header shows readable code without duplicate address", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    const code = page.getByTestId("loom-code-c-architecture");
    await expect(code).toHaveText(/^L-[0-9A-Z]{5}$/);
    await expect(page.getByTestId("loom-readable-address-c-architecture")).toHaveCount(0);
    await expect(page.getByTestId("loom-canonical-address-c-architecture")).toHaveCount(0);

    await code.hover();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("address-hint-popover")).toHaveCount(0);

    await code.click({ button: "right" });
    await expect(page.getByRole("status")).toHaveText("Link is copied");
  });

  test("Responses show code and Link promotion keeps canonical address on the code", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    const code = page.getByTestId("response-code-r-address-bar");
    const link = page.getByTestId("response-link-r-address-bar");
    await expect(code).toHaveText(/^R-[0-9A-Z]{5}$/);
    await expect(page.getByTestId("response-address-r-address-bar")).toHaveCount(0);

    await code.hover();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("address-hint-popover")).toHaveCount(0);

    await code.click({ button: "right" });
    await expect(page.getByRole("status")).toHaveText("Link is copied");

    await link.hover();
    await page.waitForTimeout(800);
    const hint = page.getByTestId("address-hint-popover");
    await expect(hint).toContainText(
      "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar"
    );
    await expect(hint.locator(".address-hint-address")).toHaveAttribute(
      "data-address-kind",
      "temporary"
    );
    const linkBox = await link.boundingBox();
    const hintBox = await hint.boundingBox();
    expect(linkBox).not.toBeNull();
    expect(hintBox).not.toBeNull();
    expect(hintBox!.y).toBeGreaterThan(linkBox!.y);
    await page.mouse.move(20, 20);

    await link.click();

    await expect(code).toHaveText(/^R-[0-9A-Z]{5}$/);
    await expect(page.getByTestId("response-address-r-address-bar")).toHaveCount(0);

    await link.hover();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("address-hint-popover")).toBeVisible();
    await expect(page.getByTestId("address-hint-popover")).toContainText(/R-[0-9A-Z]{5}/);
    await expect(page.getByTestId("address-hint-popover")).toContainText("loom://");
    await expect(page.getByTestId("address-hint-popover").locator(".address-hint-address")).toHaveAttribute(
      "data-address-kind",
      "canonical"
    );
  });

  test("Bookmark promotion keeps Response code as the only metadata affordance", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    const response = page.locator('[data-response-id="r-archive-delete"]');
    await response.getByRole("button", { name: /Bookmark suggested Archive is/ }).click();

    await expect(page.getByTestId("response-code-r-archive-delete")).toHaveText(
      /^R-[0-9A-Z]{5}$/
    );
    await expect(page.getByTestId("response-address-r-archive-delete")).toHaveCount(0);
  });
});
