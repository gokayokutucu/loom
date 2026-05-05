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

async function insertAddressBarReference(page: Page) {
  await page.getByTestId("response-link-r-address-bar").click();
  const token = page.getByTestId("inline-loom-token").last();
  await expect(token).toContainText("[[Address Bar as local AI web navigator]]");
  return token;
}

async function renameReferenceToken(page: Page, label: string) {
  const token = page.getByTestId("inline-loom-token").last();
  await token.click({ button: "right" });
  await page.getByRole("button", { name: "Rename" }).click();
  const input = page.getByLabel("Reference name");
  await expect(input).toBeFocused();
  await input.fill(label);
  await input.press("Enter");
  await expect(token).toContainText(`[[${label}]]`);
  return token;
}

test.describe("Reference display tokens", () => {
  test("global Reference display setting applies to newly inserted tokens", async ({
    page,
  }) => {
    await openApp(page);

    await page.getByRole("button", { name: "Open App Settings" }).click();
    await page.getByRole("radio", { name: "Code" }).check();
    await page.getByRole("button", { name: "Close settings" }).click();

    await openArchitectureLoom(page);
    await page.getByTestId("response-link-r-address-bar").click();
    await expect(page.getByTestId("inline-loom-token").last()).toContainText(
      /\[\[R-[0-9A-HJKMNP-TV-Z]{5}\]\]/
    );
  });

  test("new Response references default to Title mode and can switch display modes", async ({
    page,
  }) => {
    await openApp(page);
    await openArchitectureLoom(page);
    const token = await insertAddressBarReference(page);

    await token.click({ button: "right" });
    await page.getByRole("button", { name: "Show Code" }).click();
    await expect(token).toContainText(/\[\[R-[0-9A-HJKMNP-TV-Z]{5}\]\]/);

    await token.click({ button: "right" });
    await page.getByRole("button", { name: "Show Title" }).click();
    await expect(token).toContainText("[[Address Bar as local AI web navigator]]");
  });

  test("Reference token hover shows the canonical Loom address hint", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);
    const token = await insertAddressBarReference(page);

    await token.hover();
    const hint = page.getByTestId("address-hint-popover");
    await expect(hint).toBeVisible({ timeout: 4000 });
    await expect(hint).toContainText("loom://");
    await expect(hint).toContainText(/R-[0-9A-HJKMNP-TV-Z]{5}/);
  });

  test("Ctrl-clicking a Reference navigates through session history", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);
    const token = await insertAddressBarReference(page);

    await token.click({
      modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
    });
    await expect(page.locator(".address-shell input")).toHaveAttribute(
      "placeholder",
      /Address Bar as local AI web navigator/
    );

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator(".address-shell input")).toHaveAttribute(
      "placeholder",
      /Loom AI navigation architecture/
    );
  });

  test("Reference token can be renamed locally and still opens the same target", async ({
    page,
  }) => {
    await openApp(page);
    await openArchitectureLoom(page);
    const token = await insertAddressBarReference(page);

    await renameReferenceToken(page, "Local Navigator Alias");

    await page.getByRole("button", { name: /^References$/ }).first().click();
    const dropdown = page.locator(".linked-reference-dropdown");
    await expect(dropdown).toContainText("Local Navigator Alias");
    await expect(dropdown).toContainText("Address Bar as local AI web navigator");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Attach" }).click();
    await page.getByRole("tab", { name: "Responses" }).click();
    await expect(page.getByTestId("attach-content-row-response-r-address-bar")).toHaveAttribute(
      "data-attach-selected",
      "true"
    );
    await page.keyboard.press("Escape");

    await token.click({ button: "right" });
    await page.getByRole("button", { name: "Open Reference" }).click();
    await expect(page.locator(".address-shell input")).toHaveAttribute(
      "placeholder",
      /Address Bar as local AI web navigator/
    );
  });

  test("Reference rename can be cancelled with no label change", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);
    const token = await insertAddressBarReference(page);

    await token.click({ button: "right" });
    await page.getByRole("button", { name: "Rename" }).click();
    const input = page.getByLabel("Reference name");
    await input.fill("Discarded Alias");
    await page.getByRole("button", { name: "Cancel rename" }).click();

    await expect(token).toContainText("[[Address Bar as local AI web navigator]]");
    await expect(token).not.toContainText("Discarded Alias");
  });

  test("Show Title and Show Code clear a custom Reference label", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);
    let token = await insertAddressBarReference(page);

    token = await renameReferenceToken(page, "Alias To Clear");
    await token.click({ button: "right" });
    await page.getByRole("button", { name: "Show Title" }).click();
    await expect(token).toContainText("[[Address Bar as local AI web navigator]]");

    token = await renameReferenceToken(page, "Second Alias");
    await token.click({ button: "right" });
    await page.getByRole("button", { name: "Show Code" }).click();
    await expect(token).toContainText(/\[\[R-[0-9A-HJKMNP-TV-Z]{5}\]\]/);
    await expect(token).not.toContainText("Second Alias");
  });
});
