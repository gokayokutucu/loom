import { expect, type Page, test } from "@playwright/test";

const promotedAddressBarUri =
  "loom://loom-ai-navigation-architecture/L-TEST/r/R-ADDR?id=meta-response-address";

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openAppWithPromotedAddressBarResponse(page: Page) {
  await page.addInitScript((canonicalUri) => {
    window.localStorage.clear();
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

test.describe("Address Bar navigation", () => {
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
});
