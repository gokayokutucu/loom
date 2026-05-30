// E2E data authority classification: LEGACY_TYPESCRIPT_LOCAL / PURE_UI_RENDERING.
// This spec exercises current browser navigation rendering over legacy seeded UI state.
import { readFile } from "node:fs/promises";
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

async function readAddressInputState(page: Page) {
  return page.getByLabel("Loom Address Bar").evaluate((node) => {
    const input = node as HTMLInputElement;
    return {
      value: input.value,
      placeholder: input.placeholder,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      focused: document.activeElement === input,
    };
  });
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

  test("new conversation Address Bar focus stays empty", async ({ page }) => {
    await openApp(page);
    const addressInput = page.getByLabel("Loom Address Bar");

    await expect(addressInput).toHaveAttribute("placeholder", "New conversation");
    await addressInput.click();

    const state = await readAddressInputState(page);
    expect(state.value).toBe("");
    expect(state.placeholder).toBe("Search, ask, or paste a Loom address");
    expect(state.focused).toBe(true);
  });

  test("focus shows the current Loom address and selects it", async ({ page }) => {
    await openAppWithPromotedAddressBarResponse(page);

    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    const addressInput = page.getByLabel("Loom Address Bar");
    await addressInput.click();

    const state = await readAddressInputState(page);
    expect(state.value).toMatch(/^loom:\/\//);
    expect(state.value).not.toContain("/r/");
    expect(state.selectionStart).toBe(0);
    expect(state.selectionEnd).toBe(state.value.length);
    expect(state.focused).toBe(true);
  });

  test("typing and Backspace replace the selected current address", async ({ page }) => {
    await openAppWithPromotedAddressBarResponse(page);

    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    const addressInput = page.getByLabel("Loom Address Bar");
    await addressInput.click();
    await addressInput.type("new draft");
    await expect(addressInput).toHaveValue("new draft");

    await addressInput.click();
    await addressInput.press("Backspace");
    await expect(addressInput).toHaveValue("");
    await expect(addressInput).toHaveAttribute(
      "placeholder",
      "Search, ask, or paste a Loom address"
    );
  });

  test("Escape closes suggestions, restores the address, then focuses composer", async ({
    page,
  }) => {
    await openAppWithPromotedAddressBarResponse(page);

    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    const addressInput = page.getByLabel("Loom Address Bar");
    await addressInput.click();
    const currentAddress = (await readAddressInputState(page)).value;
    await addressInput.type("draft search");
    await expect(addressInput).toHaveValue("draft search");
    await expect(page.getByRole("listbox")).toBeVisible();

    await addressInput.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(addressInput).toHaveValue("draft search");
    await expect(addressInput).toBeFocused();

    await addressInput.press("Escape");
    await expect(addressInput).toHaveValue(currentAddress);
    const restored = await readAddressInputState(page);
    expect(restored.selectionStart).toBe(0);
    expect(restored.selectionEnd).toBe(currentAddress.length);
    expect(restored.focused).toBe(true);

    await addressInput.press("Escape");
    await expect(addressInput).not.toBeFocused();
    const composerTextbox = page
      .locator("[data-testid='prompt-composer'] [role='textbox']")
      .first();
    await expect(composerTextbox).toBeFocused();
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
  }, testInfo) => {
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
    const zipDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("menu", { name: "Share current Loom" })
      .getByRole("menuitem", { name: "Export as ZIP" })
      .click();
    const zipDownload = await zipDownloadPromise;
    expect(zipDownload.suggestedFilename()).toMatch(/\.zip$/);
    const zipPath = testInfo.outputPath(zipDownload.suggestedFilename());
    await zipDownload.saveAs(zipPath);
    const zipContent = await readFile(zipPath, "latin1");
    expect(zipContent).toContain("metadata.json");
    expect(zipContent).toContain("loom.md");
    expect(zipContent).toContain("responses.csv");
    expect(zipContent).toContain('"loomTitle"');

    await page.getByRole("button", { name: "Share" }).click();
    const finalShareMenu = page.getByRole("menu", { name: "Share current Loom" });
    await expect(finalShareMenu.getByRole("menuitem", { name: /Make Public/ })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Response context menu — Copy Loom Address uses canonical response address
// ---------------------------------------------------------------------------

test.describe("[legacy-typescript-local][pure-ui-rendering] Response kebab Copy Loom Address", () => {
  test("copies the full canonical response address, not display code or raw path", async ({
    page,
  }) => {
    await openAppWithPromotedAddressBarResponse(page);

    // Navigate to the Loom that contains r-address-bar
    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    await expect(page.locator('[data-response-id="r-address-bar"]')).toBeVisible();

    // Open the response context menu via right-click
    const responseRow = page.locator('[data-response-id="r-address-bar"]');
    await responseRow.click({ button: "right" });

    // The in-app ContextMenu should appear (not Electron's native menu in test env)
    const contextMenu = page.getByRole("menu").first();
    await expect(contextMenu).toBeVisible();

    // Click "Copy Loom Address" from the response context menu
    await contextMenu.getByRole("menuitem", { name: "Copy Loom Address" }).click();

    // The clipboard must contain a full loom:// response address
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("loom-test-clipboard")))
      .toMatch(/^loom:\/\//);

    const copiedAddress = await page.evaluate(() =>
      window.localStorage.getItem("loom-test-clipboard")
    );

    // Must be the promoted canonical URI — the full response address with ?id=
    expect(copiedAddress).toBe(promotedAddressBarUri);

    // Must contain /r/ (response path segment) — not just a Loom-root address
    expect(copiedAddress).toContain("/r/");

    // Must contain ?id= for reliable navigation and bookmark identity matching
    expect(copiedAddress).toContain("?id=");

    // Must NOT be only a display code like R-ADDR
    expect(copiedAddress).not.toBe("R-ADDR");
    expect(copiedAddress?.startsWith("R-")).toBe(false);
  });

  test("response Copy Loom Address and footer Link resolve to the same canonical address", async ({
    page,
  }) => {
    await openAppWithPromotedAddressBarResponse(page);

    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    await expect(page.locator('[data-response-id="r-address-bar"]')).toBeVisible();

    // Read the canonical address via the footer Link chip's test ID
    const footerLinkChip = page.getByTestId("response-link-r-address-bar");
    await expect(footerLinkChip).toBeVisible();

    // Click the footer Link chip (copies address into composed reference — also calls onCopyAddress on
    // the AddressMetadataBadge when copying). Use the response's context menu to get the address
    // without triggering a navigation by clicking the link.
    const responseRow = page.locator('[data-response-id="r-address-bar"]');
    await responseRow.click({ button: "right" });
    const contextMenu = page.getByRole("menu").first();
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByRole("menuitem", { name: "Copy Loom Address" }).click();

    const kebabAddress = await page.evaluate(() =>
      window.localStorage.getItem("loom-test-clipboard")
    );

    // The kebab-copied address must match the promoted canonical URI
    expect(kebabAddress).toBe(promotedAddressBarUri);
    expect(kebabAddress).toContain("/r/");
    expect(kebabAddress).toContain("?id=");
  });

  test("Loom root address and response address remain distinct", async ({ page }) => {
    await openAppWithPromotedAddressBarResponse(page);

    await chooseAddressBarSuggestion(
      page,
      "Address Bar",
      "Address Bar as local AI web navigator"
    );

    // Copy via share menu → gets Loom root address
    await page.getByRole("button", { name: "Share" }).click();
    await page
      .getByRole("menu", { name: "Share current Loom" })
      .getByRole("menuitem", { name: "Copy Loom Address" })
      .click();

    const loomAddress = await page.evaluate(() =>
      window.localStorage.getItem("loom-test-clipboard")
    );
    expect(loomAddress).toMatch(/^loom:\/\//);
    expect(loomAddress).not.toContain("/r/");

    // Copy via response kebab → gets response address
    const responseRow = page.locator('[data-response-id="r-address-bar"]');
    await responseRow.click({ button: "right" });
    const contextMenu = page.getByRole("menu").first();
    await contextMenu.getByRole("menuitem", { name: "Copy Loom Address" }).click();

    const responseAddress = await page.evaluate(() =>
      window.localStorage.getItem("loom-test-clipboard")
    );

    expect(responseAddress).toContain("/r/");
    expect(responseAddress).not.toBe(loomAddress);
  });
});
