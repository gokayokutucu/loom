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
  await expect(page.getByTestId("response-link-r-address-bar")).toBeVisible();
}

async function openAttachPicker(page: Page) {
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("dialog")).toContainText("Attach content");
}

async function openReferencesDropdown(page: Page) {
  await page.getByRole("button", { name: /^References$/ }).first().click();
  await expect(page.locator(".linked-reference-dropdown")).toBeVisible();
}

async function openResponsesTab(page: Page) {
  await page.getByRole("tab", { name: "Responses" }).click();
  await expect(page.getByTestId("attach-content-row-response-r-address-bar")).toBeVisible();
}

test.describe("Attach Content reference sync", () => {
  test("Response footer Link marks the Response selected in Attach Content", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    await page.getByTestId("response-link-r-address-bar").click();
    await expect(page.getByRole("button", { name: /^References$/ }).first()).toContainText("2");

    await openAttachPicker(page);
    await openResponsesTab(page);
    await expect(page.getByTestId("attach-content-row-response-r-address-bar")).toHaveAttribute(
      "data-attach-selected",
      "true"
    );

    await page.getByRole("tab", { name: "All" }).click();
    await expect(page.getByTestId("attach-content-row-response-r-address-bar")).toHaveAttribute(
      "data-attach-selected",
      "true"
    );
  });

  test("removing from References unselects the Response in Attach Content", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    await page.getByTestId("response-link-r-address-bar").click();
    await openReferencesDropdown(page);
    await page
      .locator(".linked-reference-row")
      .filter({ hasText: "Address Bar as local AI web navigator" })
      .getByTitle("Remove Reference")
      .click();

    await expect(page.getByRole("button", { name: /^References$/ }).first()).toContainText("1");
    await openAttachPicker(page);
    await openResponsesTab(page);
    await expect(page.getByTestId("attach-content-row-response-r-address-bar")).toHaveAttribute(
      "data-attach-selected",
      "false"
    );
  });

  test("selecting a Response in Attach Content updates References and can be toggled off", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);
    await openAttachPicker(page);
    await openResponsesTab(page);

    await page.getByTestId("attach-content-row-response-r-address-bar").click();
    await expect(page.getByRole("button", { name: /^References$/ }).first()).toContainText("2");
    await expect(page.getByTestId("attach-content-row-response-r-address-bar")).toHaveAttribute(
      "data-attach-selected",
      "true"
    );

    await openReferencesDropdown(page);
    await expect(page.locator(".linked-reference-dropdown")).toContainText(
      "Address Bar as local AI web navigator"
    );
    await page.keyboard.press("Escape");

    await openAttachPicker(page);
    await openResponsesTab(page);
    await page.getByTestId("attach-content-row-response-r-address-bar").click();
    await expect(page.getByRole("button", { name: /^References$/ }).first()).toContainText("1");
    await expect(page.getByTestId("attach-content-row-response-r-address-bar")).toHaveAttribute(
      "data-attach-selected",
      "false"
    );
  });
});
