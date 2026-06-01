// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
//
// Covers:
//   - Pasting a raw loom:// Loom root address inserts a reference chip, not plain text
//   - Pasting a raw loom:// Response address inserts a response-level reference chip
//   - Surrounding text is preserved when a Loom address is pasted in a mixed string
//   - Sent user-message carries the pasted reference in questionReferences
//   - Normal paste behavior is not broken (plain text and non-Loom URLs remain text)
import { expect, test, type Page } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

// ── helpers ───────────────────────────────────────────────────────────────

async function getEditor(page: Page) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  return editor;
}

async function simulatePaste(page: Page, text: string) {
  const editor = await getEditor(page);
  await editor.click();
  await editor.evaluate((el, pasteText) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", pasteText);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });
    el.dispatchEvent(event);
  }, text);
}

async function editorText(page: Page): Promise<string> {
  const editor = await getEditor(page);
  return editor.evaluate((el) => el.textContent ?? "");
}

/**
 * Returns true when the editor contains a "loom://" text node that is NOT
 * inside an .inline-loom-token chip element.
 *
 * A chip's inner textContent also contains "loom://" (it renders as
 * [[loom://…]]), so we must walk text nodes and skip those whose ancestor
 * is a chip.
 */
async function editorHasLoomAddressAsPlainText(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const editor = document.querySelector('[role="textbox"][aria-label="Prompt"]');
    if (!editor) return false;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (
        node.textContent?.includes("loom://") &&
        !node.parentElement?.closest(".inline-loom-token")
      ) {
        return true;
      }
    }
    return false;
  });
}

// Returns the data-loom-path values of all inline reference tokens in the editor.
async function editorTokenPaths(page: Page): Promise<string[]> {
  const editor = await getEditor(page);
  return editor.evaluate((el) =>
    Array.from(el.querySelectorAll<HTMLElement>(".inline-loom-token")).map(
      (token) => token.dataset.loomPath ?? ""
    )
  );
}

async function sendPrompt(page: Page) {
  await page.getByRole("button", { name: "Send" }).click();
}

/** Text visible inside the first inline-loom-token chip. */
async function firstChipText(page: Page): Promise<string> {
  const chip = page.getByTestId("inline-loom-token").first();
  return chip.evaluate((el) => el.textContent ?? "");
}

/** Send a prompt via the main composer and wait for the first QA pair. */
async function sendMainPrompt(page: Page, text: string) {
  const editor = await getEditor(page);
  await editor.click();
  await page.keyboard.insertText(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });
}

// ── tests ─────────────────────────────────────────────────────────────────

test.describe("[product-service-backed] Composer paste-as-reference chip", () => {
  // ── Loom root address ──────────────────────────────────────────────────

  test("pasting a Loom root address inserts a reference chip and removes the raw text", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const loomAddress = "loom://my-paste-test-loom/L-PASTE";
      await simulatePaste(page, loomAddress);

      // A reference token chip must have been inserted
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1);

      // The token's data-loom-path must match the pasted address
      const paths = await editorTokenPaths(page);
      expect(paths[0]).toBe(loomAddress);

      // The raw address must NOT appear as a plain text node outside a chip
      expect(await editorHasLoomAddressAsPlainText(page)).toBe(false);
    } finally {
      await scenario.cleanup();
    }
  });

  // ── Response address ───────────────────────────────────────────────────

  test("pasting a Response address inserts a response-level reference chip", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const responseAddress =
        "loom://my-paste-test-loom/L-PASTE/r/R-TEST?id=aaaabbbb-cccc-dddd-eeee-ffffffffffff";
      await simulatePaste(page, responseAddress);

      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1);

      const paths = await editorTokenPaths(page);
      expect(paths[0]).toBe(responseAddress);

      expect(await editorHasLoomAddressAsPlainText(page)).toBe(false);

      // Verify the token carries response-type data
      const tokenType = await page.getByTestId("inline-loom-token").first().evaluate((el) => {
        const token = el as HTMLElement;
        return token.dataset.loomType ?? "";
      });
      expect(tokenType).toBe("response");
    } finally {
      await scenario.cleanup();
    }
  });

  // ── Sent prompt carries questionReferences ─────────────────────────────

  test("sent user-message preserves pasted Loom address in questionReferences", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const loomAddress = "loom://paste-ref-loom/L-PERSIST";

      // Paste the address, then send the message
      await simulatePaste(page, loomAddress);
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1, { timeout: 5_000 });
      await sendPrompt(page);

      // Wait for the first QA pair to appear
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      // Retrieve the user response row and inspect its stored metadata
      const looms = await scenario.client.listLooms();
      expect(looms.length).toBeGreaterThan(0);
      const loom = looms[0];

      const detail = await scenario.fetchJson<{
        loom: { responses: Array<{ role: string; metadata?: { questionReferences?: unknown[] } }> };
      }>(`/looms/${encodeURIComponent(loom.loomId)}`);

      const userResponse = detail.loom.responses.find((r) => r.role === "user");
      expect(userResponse).toBeTruthy();
      // questionReferences must be present and non-empty
      const qrefs = userResponse?.metadata?.questionReferences ?? [];
      expect(Array.isArray(qrefs)).toBe(true);
      expect(qrefs.length).toBeGreaterThan(0);
    } finally {
      await scenario.cleanup();
    }
  });

  // ── Surrounding text preserved ─────────────────────────────────────────

  test("surrounding text is preserved when a Loom address is pasted inline", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const mixedInput = "Please compare loom://compare-loom/L-CMP with the current answer";
      await simulatePaste(page, mixedInput);

      // One chip must appear
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1);

      // Raw address must not appear as a plain text node (may appear as chip inner text)
      expect(await editorHasLoomAddressAsPlainText(page)).toBe(false);

      // The surrounding prose words must still be visible in the editor
      const text = await editorText(page);
      expect(text).toContain("Please compare");
      expect(text).toContain("with the current answer");
    } finally {
      await scenario.cleanup();
    }
  });

  // ── Plain text is unaffected ───────────────────────────────────────────

  test("pasting plain text without a Loom address keeps normal paste behavior", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const plainText = "Hello, this is plain text with no Loom address.";
      await simulatePaste(page, plainText);

      // No chip inserted
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(0);

      // Text appears verbatim in the editor
      const text = await editorText(page);
      expect(text).toContain("Hello, this is plain text");
    } finally {
      await scenario.cleanup();
    }
  });

  // ── https:// URLs are unaffected ───────────────────────────────────────

  test("pasting a normal https:// URL does not create a reference chip", async ({ page }) => {
    test.setTimeout(60_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await simulatePaste(page, "https://example.com/some/path?foo=bar");

      await expect(page.getByTestId("inline-loom-token")).toHaveCount(0);
      const text = await editorText(page);
      expect(text).toContain("https://example.com");
    } finally {
      await scenario.cleanup();
    }
  });

  // ── Multiple addresses ─────────────────────────────────────────────────

  test("pasting text with multiple Loom addresses inserts one chip per address", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const multiAddress = "First: loom://loom-a/L-111 and second: loom://loom-b/L-222";
      await simulatePaste(page, multiAddress);

      await expect(page.getByTestId("inline-loom-token")).toHaveCount(2);

      const paths = await editorTokenPaths(page);
      expect(paths).toContain("loom://loom-a/L-111");
      expect(paths).toContain("loom://loom-b/L-222");
    } finally {
      await scenario.cleanup();
    }
  });

  // ── chip label is human-readable title, not raw address ───────────────────

  test("chip for an unknown address falls back to compact code, not full raw address", async ({
    page,
  }) => {
    // This verifies that even for addresses the graph cannot resolve,
    // we never show the full raw loom:// string as the chip label.
    test.setTimeout(60_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // An address that cannot resolve in the current session graph
      const unknownAddress = "loom://unknown-loom-for-chip-label-test/L-CMPCT";
      await simulatePaste(page, unknownAddress);

      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1);

      const chipText = await firstChipText(page);
      // Must show compact fallback "L-CMPCT", not the full address
      expect(chipText).toContain("L-CMPCT");
      expect(chipText).not.toContain("loom://unknown-loom-for-chip-label-test");
    } finally {
      await scenario.cleanup();
    }
  });

  test("chip for a known Loom shows its human-readable title, not the raw address", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // Create a Loom by sending a prompt — the Loom title comes from the prompt
      await sendMainPrompt(
        page,
        "Event Sourcing deep dive for paste chip title test"
      );

      // Get the canonical URI of the freshly-created Loom from the service
      const looms = await scenario.client.listLooms();
      const targetLoom = looms.find((l) => l.title.includes("Event Sourcing"));
      expect(targetLoom).toBeTruthy();
      const loomAddress = targetLoom!.canonicalUri;
      expect(loomAddress).toBeTruthy();
      expect(loomAddress!.startsWith("loom://")).toBe(true);

      // Clear the editor and paste the address
      const editor = await getEditor(page);
      await editor.click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.press("Backspace");

      await simulatePaste(page, loomAddress!);

      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1, {
        timeout: 5_000,
      });

      // The chip must show the Loom title, not the raw loom:// address
      const chipText = await firstChipText(page);
      expect(chipText).not.toContain("loom://");
      // The title is "Event Sourcing deep dive for paste chip title test"
      // Chip renders as [[Title]] so textContent includes [[…]]
      expect(chipText).toContain("Event Sourcing");

      // Raw address is still in data-loom-path (identity preserved)
      const paths = await editorTokenPaths(page);
      expect(paths[0]).toBe(loomAddress);
    } finally {
      await scenario.cleanup();
    }
  });

  test("chip for a Response address is response-type and shows compact label, not raw address", async ({
    page,
  }) => {
    // Verifies that when a Response address (?id=…) is pasted:
    // 1. The chip type is "response".
    // 2. The chip label is the compact code (e.g. L-ABCDE), not the full raw address.
    // 3. The raw address is preserved in data-loom-path (identity intact).
    //
    // Note: deterministic test responses do not have canonical URIs assigned, so we
    // construct a valid-format response address to exercise the resolution path.
    test.setTimeout(60_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });

    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // A well-formed response address (unknown to the graph → tests fallback path)
      const responseAddress =
        "loom://response-label-test-loom/L-RSPNS/r/R-ABCDE?id=aaaa0000-bbbb-cccc-dddd-eeeeffffffff";
      await simulatePaste(page, responseAddress);

      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1, { timeout: 5_000 });

      // Chip data-loom-type must be "response"
      const tokenType = await page
        .getByTestId("inline-loom-token")
        .first()
        .evaluate((el) => (el as HTMLElement).dataset.loomType ?? "");
      expect(tokenType).toBe("response");

      // Chip label must be compact (L-RSPNS code extracted), not the full address
      const chipText = await firstChipText(page);
      expect(chipText).not.toContain("loom://");
      expect(chipText).toContain("L-RSPNS");

      // Raw address preserved in data-loom-path
      const paths = await editorTokenPaths(page);
      expect(paths[0]).toBe(responseAddress);
    } finally {
      await scenario.cleanup();
    }
  });
});
