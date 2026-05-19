// E2E data authority classification: LEGACY_TYPESCRIPT_LOCAL / PURE_UI_RENDERING.
// This spec exercises current browser navigation rendering over legacy seeded UI state.
import { expect, type Page, test } from "@playwright/test";

const promotedAddressBarUri =
  "loom://loom-ai-navigation-architecture/L-TEST/r/R-ADDR?id=r-address-bar";

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "loom-ai-app-settings-v1",
      JSON.stringify({ mockDataEnabled: true })
    );
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openAppWithPromotedAddressBarResponse(page: Page) {
  await page.addInitScript((canonicalUri) => {
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async write(items: ClipboardItem[]) {
          const item = items[0];
          const blob = await item.getType("text/plain");
          window.localStorage.setItem("loom-test-clipboard", await blob.text());
        },
        async writeText(value: string) {
          window.localStorage.setItem("loom-test-clipboard", value);
        },
      },
    });
    window.localStorage.setItem(
      "loom-ai-app-settings-v1",
      JSON.stringify({ mockDataEnabled: true })
    );
    window.localStorage.setItem(
      "loom.runtime.metadata.v1",
      JSON.stringify({
        "response:c-architecture:r-address-bar": {
          id: "meta-response-address",
          code: "R-ADDR",
          title: "Address Bar as local AI web navigator",
          canonicalUri,
          keywords: ["address", "navigation", "browser"],
          summary: "Address Bar response metadata.",
          usageCount: 1,
          status: "addressable",
        },
      })
    );
  }, promotedAddressBarUri);
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function chooseAddressBarSuggestion(page: Page, query: string, title: string) {
  const addressInput = page.getByLabel("Loom Address Bar");
  await addressInput.click();
  await addressInput.fill(query);
  await expect(page.getByRole("option", { name: new RegExp(title) })).toBeVisible();
  await page.getByRole("option", { name: new RegExp(title) }).click();
}

test.describe("[legacy-typescript-local][pure-ui-rendering] Address Bar navigation", () => {
  test("clicking the focused Address Bar reopens suggestions after dismissal", async ({ page }) => {
    await openApp(page);
    const addressInput = page.getByLabel("Loom Address Bar");

    await addressInput.click();
    await expect(page.getByRole("listbox")).toBeVisible();

    await addressInput.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(addressInput).toBeFocused();

    await addressInput.click();
    await expect(page.getByRole("listbox")).toBeVisible();
  });

  test("selecting a Response suggestion opens its Loom and exact Response", async ({ page }) => {
    await openApp(page);

    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    await expect(page.locator(".conversation-context h1").first()).toHaveText(
      "Loom AI navigation architecture"
    );
    await expect(page.getByLabel("Loom Address Bar")).toHaveAttribute(
      "placeholder",
      /Loom AI navigation architecture \/ Address Bar as local AI web navigator/
    );
    await expect(page.locator('[data-response-id="r-address-bar"]')).toBeVisible();
  });

  test("legacy suggestion paths still open promoted canonical Response targets", async ({ page }) => {
    await openAppWithPromotedAddressBarResponse(page);

    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    const response = page.locator('[data-response-id="r-address-bar"]');
    await expect(page.locator(".conversation-context h1").first()).toHaveText(
      "Loom AI navigation architecture"
    );
    await expect(page.getByLabel("Loom Address Bar")).toHaveAttribute(
      "placeholder",
      /Loom AI navigation architecture \/ Address Bar as local AI web navigator/
    );
    await expect(response).toBeVisible();
    await expect(response).toHaveAttribute("data-response-address", promotedAddressBarUri);
  });

  test("share menu actions use the active Loom address even when a Response is focused", async ({
    page,
  }) => {
    await openAppWithPromotedAddressBarResponse(page);

    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    await expect(page.getByLabel("Loom Address Bar")).toHaveAttribute(
      "placeholder",
      /Loom AI navigation architecture \/ Address Bar as local AI web navigator/
    );

    const expectedLoomTitle = "Loom AI navigation architecture";

    await page.getByRole("button", { name: "Share" }).click();
    const shareMenu = page.getByRole("menu", { name: "Share current Loom" });
    await expect(shareMenu).toBeVisible();
    await shareMenu.getByRole("menuitem", { name: "Copy Loom Address" }).click();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("loom-test-clipboard")))
      .not.toContain("/r/");
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("loom-test-clipboard")))
      .toMatch(/^loom:\/\/loom-ai-navigation-architecture\/L-[A-Z0-9]+/);
    const copiedLoomAddress = await page.evaluate(() =>
      window.localStorage.getItem("loom-test-clipboard")
    );
    expect(copiedLoomAddress).toBeTruthy();
    expect(copiedLoomAddress).not.toBe(promotedAddressBarUri);

    await page.getByRole("button", { name: "Share" }).click();
    await page
      .getByRole("menu", { name: "Share current Loom" })
      .getByRole("menuitem", { name: "Copy Markdown Link" })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("loom-test-clipboard")))
      .toBe(`[${expectedLoomTitle}](${copiedLoomAddress})`);

    await page.getByRole("button", { name: "Share" }).click();
    await page
      .getByRole("menu", { name: "Share current Loom" })
      .getByRole("menuitem", { name: "Copy Title + Address" })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("loom-test-clipboard")))
      .toBe(`${expectedLoomTitle}\n${copiedLoomAddress}`);

    await page.getByRole("button", { name: "Share" }).click();
    const markdownDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("menu", { name: "Share current Loom" })
      .getByRole("menuitem", { name: "Export as Markdown" })
      .click();
    const markdownDownload = await markdownDownloadPromise;
    expect(markdownDownload.suggestedFilename()).toMatch(/\.md$/);

    await page.getByRole("button", { name: "Share" }).click();
    const csvDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("menu", { name: "Share current Loom" })
      .getByRole("menuitem", { name: "Export as CSV" })
      .click();
    const csvDownload = await csvDownloadPromise;
    expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/);

    await page.getByRole("button", { name: "Share" }).click();
    const finalShareMenu = page.getByRole("menu", { name: "Share current Loom" });
    await expect(finalShareMenu.getByRole("menuitem", { name: "Export as ZIP" })).toBeDisabled();
    await expect(finalShareMenu.getByRole("menuitem", { name: /Make Public/ })).toBeDisabled();
  });
});
