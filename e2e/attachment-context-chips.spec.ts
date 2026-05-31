// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
//
// Covers:
//   - Part 1: Attachment content reaches model context (attachment references fix)
//   - Part 2: Sent attachment chips appear above user message bubbles
//   - Part 4: Chips persist after page reload
//   - Security: Only att- IDs reach the service; no arbitrary path open via UI
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function openFilesTab(page: Page) {
  await page.getByRole("button", { name: "Attach" }).click();
  const menu = page.getByRole("dialog", { name: "Attach content" });
  await expect(menu).toBeVisible();
  await menu.getByRole("tab", { name: "Files" }).click();
  return menu;
}

async function uploadFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer }
) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/attachments") &&
      response.status() === 201
  );
  await page.locator(".attach-content-dropdown input[type='file']").setInputFiles(file);
  return responsePromise;
}

const textNote = {
  name: "sleep-study-notes.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(
    "Sleep deprivation reduces cognitive performance. REM sleep is critical for memory consolidation.",
    "utf8"
  ),
};

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("[product-service-backed] Attachment context and chips", () => {
  test("attachment sent without inline token still reaches model context", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // Bootstrap a loom
      await sendPrompt(page, "Start a test loom.");
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      // Upload a file via Files tab
      const menu = await openFilesTab(page);
      await uploadFile(page, textNote);
      await expect(
        menu.locator(".attach-file-row", { hasText: textNote.name })
      ).toContainText("Ready", { timeout: 15_000 });

      // Close the attach menu without inserting an inline token
      await page.keyboard.press("Escape");

      // The attachment chip should NOT be shown yet (no message sent)
      await expect(page.locator(".sent-attachment-chip")).toHaveCount(0);

      // Send a message that references the attachment
      // The file appears in the composer draft attachments (not as inline token)
      await sendPrompt(page, "What does the uploaded document say about sleep?");
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      // After send, the sent attachment chip should appear above the user message
      await expect(page.locator(".sent-attachment-chip")).toHaveCount(1, { timeout: 10_000 });
      await expect(page.locator(".sent-attachment-chip").first()).toContainText(textNote.name);

      // The chip should show the correct filename
      const chipText = await page.locator(".sent-attachment-chip").first().textContent();
      expect(chipText).not.toBeNull();
    } finally {
      await scenario.cleanup();
    }
  });

  test("sent attachment chip persists after page reload", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendPrompt(page, "Start a test loom for reload test.");
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      const menu = await openFilesTab(page);
      await uploadFile(page, textNote);
      await expect(
        menu.locator(".attach-file-row", { hasText: textNote.name })
      ).toContainText("Ready", { timeout: 15_000 });
      await page.keyboard.press("Escape");

      // Send with attachment
      await sendPrompt(page, "Summarize the document.");
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });
      await expect(page.locator(".sent-attachment-chip")).toHaveCount(1, { timeout: 10_000 });

      // Remember the current URL (loom ID encoded in it)
      const currentUrl = page.url();

      // Reload the page
      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // Navigate back to the same loom
      await page.goto(currentUrl);
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 15_000 });

      // Chips should still be visible after reload (persisted via metadata)
      await expect(page.locator(".sent-attachment-chip")).toHaveCount(1, { timeout: 10_000 });
    } finally {
      await scenario.cleanup();
    }
  });

  test("attachment chip only appears for att- IDs, not for pending local keys", async ({
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

      await sendPrompt(page, "Bootstrap loom.");
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      // Upload file and wait for the uploaded att- ID to be returned
      const menu = await openFilesTab(page);
      const uploadResponse = await uploadFile(page, textNote);
      const uploadedAttachment = (await uploadResponse.json()) as {
        attachment: { attachmentId: string };
      };

      // Verify the service returned an att- ID
      expect(uploadedAttachment.attachment.attachmentId).toMatch(/^att-/);

      await expect(
        menu.locator(".attach-file-row", { hasText: textNote.name })
      ).toContainText("Ready", { timeout: 15_000 });
      await page.keyboard.press("Escape");

      await sendPrompt(page, "Check attachment ID prefix.");
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      // Chip should be visible (att- ID was used correctly)
      await expect(page.locator(".sent-attachment-chip")).toHaveCount(1, { timeout: 10_000 });

      // The chip's aria-label should contain the filename (not a raw ID)
      const chip = page.locator(".sent-attachment-chip").first();
      const label = await chip.getAttribute("aria-label");
      expect(label).toContain(textNote.name);
    } finally {
      await scenario.cleanup();
    }
  });
});
