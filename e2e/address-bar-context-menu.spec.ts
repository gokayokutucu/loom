// E2E data authority classification: LEGACY_TYPESCRIPT_LOCAL / PURE_UI_RENDERING.
// Tests the address bar right-click context menu:
//   - browser fallback (no loomDesktop bridge) — no crash
//   - action execution when the Electron bridge is mocked in-page
//   - keyboard shortcuts still function after context menu interaction
//   - Copy Clean Link, Paste and Go, Select All, Cut, Copy, Paste, Delete
import { expect, type Page, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Opens the app in mock-data mode without any Electron bridge. */
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

type ContextMenuAction =
  | "undo" | "redo" | "cut" | "copy" | "paste" | "delete"
  | "selectAll" | "pasteAndGo" | "pasteAndGoToLoom" | "copyCleanLink" | "none";

interface MockContextMenuResult {
  action: ContextMenuAction;
  clipboardText: string;
}

/**
 * Opens the app with a mocked Electron address bar bridge.
 * The bridge resolves each contextmenu call with whatever result is stored in
 * window.__nextContextMenuResult at call time.
 * Also stubs navigator.clipboard so we can read what was written.
 */
async function openAppWithMockedBridge(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "loom-ai-app-settings-v1",
      JSON.stringify({ mockDataEnabled: true })
    );

    // Clipboard stub — writes go to localStorage so tests can inspect them
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value: string) {
          window.localStorage.setItem("loom-test-clipboard", value);
        },
        async readText() {
          return window.localStorage.getItem("loom-test-clipboard") ?? "";
        },
      },
    });

    // Provide a default result; tests override it via __setNextContextMenuResult
    (window as any).__nextContextMenuResult = { action: "none", clipboardText: "" };
    (window as any).__lastContextMenuParams = null;

    // Mock the Electron bridge — isElectron=false keeps the UI unchanged but
    // addressBar.showContextMenu is present, which is all the handler checks.
    (window as any).loomDesktop = {
      getRuntimeInfo: () => ({
        isElectron: false,
        platform: "web",
      }),
      addressBar: {
        showContextMenu(params: unknown) {
          (window as any).__lastContextMenuParams = params;
          return Promise.resolve((window as any).__nextContextMenuResult);
        },
      },
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

/** Programs the next contextmenu result. */
async function setNextMenuResult(page: Page, result: MockContextMenuResult) {
  await page.evaluate((r) => {
    (window as any).__nextContextMenuResult = r;
  }, result);
}

async function readClipboard(page: Page) {
  return page.evaluate(() => window.localStorage.getItem("loom-test-clipboard") ?? "");
}

async function getAddressInputState(page: Page) {
  return page.getByLabel("Loom Address Bar").evaluate((el) => {
    const input = el as HTMLInputElement;
    return {
      value: input.value,
      selectionStart: input.selectionStart,
      selectionEnd: input.selectionEnd,
      focused: document.activeElement === input,
    };
  });
}

/** Focuses address bar, fills it, and selects a portion of the text. */
async function fillAndSelect(
  page: Page,
  text: string,
  selStart: number,
  selEnd: number
) {
  const input = page.getByLabel("Loom Address Bar");
  await input.click();
  await input.fill(text);
  await input.evaluate(
    (el, [s, e]) => (el as HTMLInputElement).setSelectionRange(s, e),
    [selStart, selEnd]
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("[legacy-typescript-local][pure-ui-rendering] Address bar context menu", () => {
  // ── Browser fallback ──────────────────────────────────────────────────────

  test("right-clicking address bar in browser mode (no Electron bridge) does not crash", async ({
    page,
  }) => {
    await openApp(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();

    // Should not throw; browser's native menu would appear (we can't interact
    // with it in Playwright, but the app must still be usable afterwards)
    await input.dispatchEvent("contextmenu");

    // Input still responds to keyboard input
    await input.fill("test query");
    await expect(input).toHaveValue("test query");
  });

  test("keyboard shortcuts are unaffected after a right-click in browser mode", async ({
    page,
  }) => {
    await openApp(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await input.fill("hello world");

    // Simulate right-click
    await input.dispatchEvent("contextmenu");

    // Cmd+A should still select all
    await input.press("Meta+a");
    const state = await getAddressInputState(page);
    expect(state.selectionStart).toBe(0);
    expect(state.selectionEnd).toBe(state.value.length);
  });

  // ── Select All ────────────────────────────────────────────────────────────

  test("Select All action selects entire input content", async ({ page }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await input.fill("some address text");
    // Move cursor to middle so not all is selected
    await input.evaluate((el) =>
      (el as HTMLInputElement).setSelectionRange(4, 4)
    );

    await setNextMenuResult(page, { action: "selectAll", clipboardText: "" });
    await input.dispatchEvent("contextmenu");

    await expect
      .poll(() => getAddressInputState(page))
      .toMatchObject({ selectionStart: 0, selectionEnd: "some address text".length });
  });

  test("Select All is disabled when all text is already selected (params)", async ({ page }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await input.fill("abc");
    // Select all manually
    await input.evaluate((el) =>
      (el as HTMLInputElement).setSelectionRange(0, 3)
    );

    await setNextMenuResult(page, { action: "none", clipboardText: "" });
    await input.dispatchEvent("contextmenu");

    const params = await page.evaluate(() => (window as any).__lastContextMenuParams);
    expect(params.allSelected).toBe(true);
    expect(params.hasSelection).toBe(true);
  });

  // ── Copy ──────────────────────────────────────────────────────────────────

  test("Copy action writes selected text to clipboard", async ({ page }) => {
    await openAppWithMockedBridge(page);
    await fillAndSelect(page, "hello world", 6, 11); // select "world"

    await setNextMenuResult(page, { action: "copy", clipboardText: "" });
    await page.getByLabel("Loom Address Bar").dispatchEvent("contextmenu");

    expect(await readClipboard(page)).toBe("world");
  });

  test("Copy passes hasSelection=true when text is selected", async ({ page }) => {
    await openAppWithMockedBridge(page);
    await fillAndSelect(page, "hello world", 0, 5); // select "hello"

    await setNextMenuResult(page, { action: "none", clipboardText: "" });
    await page.getByLabel("Loom Address Bar").dispatchEvent("contextmenu");

    const params = await page.evaluate(() => (window as any).__lastContextMenuParams);
    expect(params.hasSelection).toBe(true);
  });

  test("Copy passes hasSelection=false when no text is selected", async ({ page }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await input.fill("hello world");
    // Set cursor without selection
    await input.evaluate((el) =>
      (el as HTMLInputElement).setSelectionRange(3, 3)
    );

    await setNextMenuResult(page, { action: "none", clipboardText: "" });
    await input.dispatchEvent("contextmenu");

    const params = await page.evaluate(() => (window as any).__lastContextMenuParams);
    expect(params.hasSelection).toBe(false);
  });

  // ── Cut ───────────────────────────────────────────────────────────────────

  test("Cut action removes selected text and writes it to clipboard", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    await fillAndSelect(page, "hello world", 6, 11); // select "world"

    await setNextMenuResult(page, { action: "cut", clipboardText: "" });
    await page.getByLabel("Loom Address Bar").dispatchEvent("contextmenu");

    // Value should have the selected part removed
    await expect(page.getByLabel("Loom Address Bar")).toHaveValue("hello ");
    expect(await readClipboard(page)).toBe("world");
  });

  // ── Delete ────────────────────────────────────────────────────────────────

  test("Delete action removes selected text without touching clipboard", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    await page.evaluate(() =>
      window.localStorage.setItem("loom-test-clipboard", "previous")
    );
    await fillAndSelect(page, "hello world", 0, 5); // select "hello"

    await setNextMenuResult(page, { action: "delete", clipboardText: "" });
    await page.getByLabel("Loom Address Bar").dispatchEvent("contextmenu");

    await expect(page.getByLabel("Loom Address Bar")).toHaveValue(" world");
    // Clipboard must NOT have been modified
    expect(await readClipboard(page)).toBe("previous");
  });

  // ── Paste ─────────────────────────────────────────────────────────────────

  test("Paste action inserts clipboard text at cursor position", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await input.fill("hello ");
    // Place cursor at the end (selectionStart === selectionEnd === 6)
    await input.evaluate((el) =>
      (el as HTMLInputElement).setSelectionRange(6, 6)
    );

    await setNextMenuResult(page, { action: "paste", clipboardText: "world" });
    await input.dispatchEvent("contextmenu");

    await expect(input).toHaveValue("hello world");
  });

  test("Paste action replaces selected text with clipboard content", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    await fillAndSelect(page, "hello world", 6, 11); // select "world"

    await setNextMenuResult(page, {
      action: "paste",
      clipboardText: "loom",
    });
    await page.getByLabel("Loom Address Bar").dispatchEvent("contextmenu");

    await expect(page.getByLabel("Loom Address Bar")).toHaveValue("hello loom");
  });

  // ── Paste and Go ──────────────────────────────────────────────────────────

  test("Paste and Go triggers navigation and leaves the address bar unfocused", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await expect(input).toBeFocused();

    await setNextMenuResult(page, {
      action: "pasteAndGo",
      clipboardText: "event sourcing design",
    });
    await input.dispatchEvent("contextmenu");

    // After pasteAndGo with free text, onStartNewLoomFromAddressBar is called
    // which dispatches FREE_TEXT_DETECTED and blurs the address bar.
    // The address bar value becomes "" when unfocused (controlled input pattern).
    await expect(input).not.toBeFocused();
    await expect(input).toHaveValue("");
  });

  // ── Paste and Go to Loom ──────────────────────────────────────────────────

  test("Paste and Go to Loom navigates to a loom:// address", async ({ page }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();

    const loomAddress = "loom://loom-ai-navigation-architecture/L-TEST";
    await setNextMenuResult(page, {
      action: "pasteAndGoToLoom",
      clipboardText: loomAddress,
    });
    await input.dispatchEvent("contextmenu");

    await expect(input).toHaveValue(loomAddress);
  });

  // ── Copy Clean Link ───────────────────────────────────────────────────────

  test("Copy Clean Link action writes canonical loom address to clipboard", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();

    // Fill in a loom address (with trailing noise) so it's parsed as the
    // currentDestination for the mock
    const messyAddress = "loom://my-loom/L-CJ44ET).";
    await input.fill(messyAddress);

    await setNextMenuResult(page, {
      action: "copyCleanLink",
      clipboardText: "",
    });
    await input.dispatchEvent("contextmenu");

    // The handler resolves the clean address from the current destination or
    // the selected/current value. Since this is browser mode with no real
    // loom routing, the fallback checks the input value itself.
    const copied = await readClipboard(page);
    // Trailing sentence punctuation must be stripped
    expect(copied).not.toMatch(/[).\],;:!?]$/);
    expect(copied).toMatch(/^loom:\/\//);
  });

  test("Copy Clean Link passes hasLoomAddress=true when address bar has loom:// value", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await input.fill("loom://my-loom/L-123");

    await setNextMenuResult(page, { action: "none", clipboardText: "" });
    await input.dispatchEvent("contextmenu");

    const params = await page.evaluate(() => (window as any).__lastContextMenuParams);
    expect(params.hasLoomAddress).toBe(true);
  });

  test("Copy Clean Link passes hasLoomAddress=true when selected text is a loom:// URL", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    const loomAddr = "loom://my-loom/L-SEL";
    await fillAndSelect(page, loomAddr, 0, loomAddr.length);

    await setNextMenuResult(page, { action: "none", clipboardText: "" });
    await page.getByLabel("Loom Address Bar").dispatchEvent("contextmenu");

    const params = await page.evaluate(() => (window as any).__lastContextMenuParams);
    expect(params.hasLoomAddress).toBe(true);
    expect(params.hasSelection).toBe(true);
  });

  // NOTE: hasLoomAddress is always true in this app because even the draft
  // navigation destination uses a loom:// path ("loom://drafts/new-conversation").
  // Exhaustive false-case testing belongs in the unit tests for extractCleanLoomAddress.

  // ── Input remains usable after every action ───────────────────────────────

  test("input remains focused and functional after context menu interaction", async ({
    page,
  }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await input.fill("initial value");

    await setNextMenuResult(page, { action: "none", clipboardText: "" });
    await input.dispatchEvent("contextmenu");

    // After the menu closes, input must be focused and accept input
    await expect(input).toBeFocused();
    await input.fill("new value");
    await expect(input).toHaveValue("new value");
  });

  // ── hasText param ─────────────────────────────────────────────────────────

  test("passes hasText=false when input is empty", async ({ page }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    // Input value is empty on a new conversation

    await setNextMenuResult(page, { action: "none", clipboardText: "" });
    await input.dispatchEvent("contextmenu");

    const params = await page.evaluate(() => (window as any).__lastContextMenuParams);
    expect(params.hasText).toBe(false);
    expect(params.hasSelection).toBe(false);
  });

  test("passes hasText=true when input has content", async ({ page }) => {
    await openAppWithMockedBridge(page);
    const input = page.getByLabel("Loom Address Bar");
    await input.click();
    await input.fill("something");

    await setNextMenuResult(page, { action: "none", clipboardText: "" });
    await input.dispatchEvent("contextmenu");

    const params = await page.evaluate(() => (window as any).__lastContextMenuParams);
    expect(params.hasText).toBe(true);
  });
});
