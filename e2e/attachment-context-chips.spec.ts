// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
//
// Covers:
//   - Part 1: Attachment content reaches model context (attachment references fix)
//   - Part 2: Sent attachment chips appear above user message bubbles
//   - Part 4: Chips persist after page reload
//   - Security: Only att- IDs reach the service; no arbitrary path open via UI
import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

const execFileAsync = promisify(execFile);

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

async function closeAttachMenu(page: Page) {
  await page.keyboard.press("Escape");
  const menu = page.getByRole("dialog", { name: "Attach content" });
  if (await menu.isVisible()) {
    await page.mouse.click(12, 12);
  }
  await expect(menu).toBeHidden();
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

async function dropFilesOnComposer(
  page: Page,
  files: Array<{ name: string; mimeType: string; content: string }>
) {
  const dataTransfer = await page.evaluateHandle((droppedFiles) => {
    const transfer = new DataTransfer();
    droppedFiles.forEach((file) => {
      transfer.items.add(
        new File([file.content], file.name, {
          type: file.mimeType,
          lastModified: 1_700_000_000_000,
        })
      );
    });
    return transfer;
  }, files);
  const surface = page.getByTestId("prompt-surface").first();
  await surface.dispatchEvent("dragenter", { dataTransfer });
  await expect(surface).toHaveClass(/drag-over/);
  await surface.dispatchEvent("dragover", { dataTransfer });
  await surface.dispatchEvent("drop", { dataTransfer });
  await expect(surface).not.toHaveClass(/drag-over/);
  await dataTransfer.dispose();
}

async function expectSentAttachmentTray(page: Page, fileNames: string[]) {
  const chips = page.locator(".sent-attachment-chip");
  await expect(chips).toHaveCount(fileNames.length, { timeout: 10_000 });
  for (const fileName of fileNames) {
    await expect(chips.filter({ hasText: fileName })).toHaveCount(1);
    await expect(page.locator(".inline-loom-token", { hasText: fileName })).toHaveCount(0);
  }
  const chipGroup = page.locator(".sent-attachment-tray").filter({ hasText: fileNames[0] }).first();
  await expect(chipGroup).toBeVisible();
  const layout = await chipGroup.evaluate((element) => {
    const turn = element.closest<HTMLElement>(".user-turn");
    const bubble = turn?.querySelector<HTMLElement>(".user-message");
    const chips = Array.from(element.querySelectorAll<HTMLElement>(".sent-attachment-chip"));
    const trayRect = element.getBoundingClientRect();
    const bubbleRect = bubble?.getBoundingClientRect();
    return {
      trayInsideBubble: bubble?.contains(element) ?? true,
      trayRight: trayRect.right,
      bubbleRight: bubbleRect?.right ?? null,
      trayBottom: trayRect.bottom,
      bubbleTop: bubbleRect?.top ?? null,
      chipRows: chips.map((chip) => {
        const rect = chip.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }),
    };
  });
  expect(layout.trayInsideBubble).toBe(false);
  expect(layout.trayRight).toBeCloseTo(layout.bubbleRight!, 1);
  expect(layout.trayBottom).toBeLessThanOrEqual(layout.bubbleTop!);
  for (let index = 1; index < layout.chipRows.length; index += 1) {
    expect(layout.chipRows[index].top).toBeGreaterThanOrEqual(
      layout.chipRows[index - 1].bottom
    );
  }
}

async function expectSingleSentAttachmentChip(page: Page, fileName: string) {
  await expectSentAttachmentTray(page, [fileName]);
}

function sqliteString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function sqliteJsonRows<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync("/usr/bin/sqlite3", ["-json", dbPath, sql]);
  return stdout.trim() ? (JSON.parse(stdout) as T[]) : [];
}

const textNote = {
  name: "sleep-study-notes.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(
    "Sleep deprivation reduces cognitive performance. REM sleep is critical for memory consolidation. LOOM_ATTACHMENT_CONTEXT_SENTINEL_123.",
    "utf8"
  ),
};

const firstTurnNote = {
  name: "first-turn-sentinel.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(
    "This first-turn file contains LOOM_FIRST_TURN_ATTACHMENT_SENTINEL_789.",
    "utf8"
  ),
};

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe("[product-service-backed] Attachment context and chips", () => {
  test("first-turn tray attachment reaches model context and survives retry", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const menu = await openFilesTab(page);
      await uploadFile(page, firstTurnNote);
      await expect(
        menu.locator(".attach-file-row", { hasText: firstTurnNote.name })
      ).toContainText("Ready", { timeout: 15_000 });
      await closeAttachMenu(page);

      await sendPrompt(page, "Please review the attached file and quote the sentinel.");
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });
      await expectSingleSentAttachmentChip(page, firstTurnNote.name);
      await expect(page.locator(".assistant-message").last()).toContainText(
        "LOOM_FIRST_TURN_ATTACHMENT_SENTINEL_789",
        { timeout: 30_000 }
      );

      const responseCodeBadge = page.locator(".response-code-badge").last();
      const responseCode = (await responseCodeBadge.innerText()).trim();
      expect(responseCode).toMatch(/^R-[0-9A-HJKMNP-TV-Z]{5}$/);
      const responseTestId = await responseCodeBadge.getAttribute("data-testid");
      const assistantResponseId = responseTestId?.replace(/^response-code-/, "");
      expect(assistantResponseId).toBeTruthy();
      const responseRows = await sqliteJsonRows<{
        response_id: string;
        loom_id: string;
        role: string;
        sequence_index: number;
        metadata_json: string | null;
      }>(
        scenario.dbPath,
        `SELECT response_id, loom_id, role, sequence_index, metadata_json
         FROM responses
         WHERE response_id = ${sqliteString(assistantResponseId!)}`
      );
      expect(responseRows).toHaveLength(1);
      const assistantRow = responseRows[0];
      expect(assistantRow.role).toBe("assistant");
      const userRows = await sqliteJsonRows<{
        response_id: string;
        metadata_json: string;
      }>(
        scenario.dbPath,
        `SELECT response_id, metadata_json
         FROM responses
         WHERE loom_id = ${sqliteString(assistantRow.loom_id)}
           AND sequence_index = ${assistantRow.sequence_index - 1}
           AND role = 'user'`
      );
      expect(userRows).toHaveLength(1);
      const userMetadata = JSON.parse(userRows[0].metadata_json) as {
        references?: Array<{ targetKind?: string; targetId?: string }>;
        questionReferences?: Array<{ targetKind?: string; targetObjectId?: string; id?: string }>;
      };
      expect(
        userMetadata.questionReferences?.some(
          (reference) =>
            reference.targetKind === "attachment" &&
            (reference.targetObjectId ?? reference.id)?.startsWith("att-")
        )
      ).toBe(true);
      expect(
        userMetadata.references?.some(
          (reference) =>
            reference.targetKind === "attachment" &&
            reference.targetId?.startsWith("att-")
        )
      ).toBe(true);

      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page
        .getByRole("button", { name: /Open Please review the attached file/ })
        .click();
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 15_000 });
      await expectSingleSentAttachmentChip(page, firstTurnNote.name);

      let retryAnswer = "";
      for await (const event of scenario.client.retryUserMessage({
        loomId: assistantRow.loom_id,
        userResponseId: userRows[0].response_id,
        responseMode: "auto",
        softDeleteDownstream: true,
        reason: "retry_from_user_message",
        model: "deterministic-event-sourcing:e2e",
        options: { numCtx: 8192, numPredict: 1024 },
      })) {
        if (event.type === "content_delta") retryAnswer += event.payload.delta;
      }
      expect(retryAnswer).toContain("LOOM_FIRST_TURN_ATTACHMENT_SENTINEL_789");
    } finally {
      await scenario.cleanup();
    }
  });

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
      await closeAttachMenu(page);

      // The attachment chip should NOT be shown yet (no message sent)
      await expect(page.locator(".sent-attachment-chip")).toHaveCount(0);

      // Send a message that references the attachment
      // The file appears in the composer draft attachments (not as inline token)
      await sendPrompt(page, "What does the attached uploaded document say about sleep?");
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });
      await expect(page.locator(".assistant-message").last()).toContainText(
        "LOOM_ATTACHMENT_CONTEXT_SENTINEL_123",
        { timeout: 30_000 }
      );

      // After send, the sent attachment chip should appear above the user message
      await expectSingleSentAttachmentChip(page, textNote.name);

      // The chip should show the correct filename
      const chipText = await page.locator(".sent-attachment-chip").first().textContent();
      expect(chipText).not.toBeNull();

      await sendPrompt(page, "What was in the attached document?");
      await expect(page.locator(".qa-item")).toHaveCount(3, { timeout: 30_000 });
      await expect(page.locator(".assistant-message").last()).toContainText(
        "LOOM_ATTACHMENT_CONTEXT_SENTINEL_123",
        { timeout: 30_000 }
      );
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
      await closeAttachMenu(page);

      // Send with attachment
      await sendPrompt(page, "Summarize the document.");
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });
      await expectSingleSentAttachmentChip(page, textNote.name);

      // Reload the page
      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      // Reopen the persisted Loom through product navigation; the app URL does
      // not encode active Loom state.
      await page
        .getByRole("button", { name: /Open Start a test loom for reload test/ })
        .click();
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 15_000 });

      // Chips should still be visible after reload (persisted via metadata)
      await expectSingleSentAttachmentChip(page, textNote.name);
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
      await closeAttachMenu(page);

      await sendPrompt(page, "Check attachment ID prefix.");
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      // Chip should be visible (att- ID was used correctly)
      await expectSingleSentAttachmentChip(page, textNote.name);

      // The chip's aria-label should contain the filename (not a raw ID)
      const chip = page.locator(".sent-attachment-chip").first();
      const label = await chip.getAttribute("aria-label");
      expect(label).toContain(textNote.name);
    } finally {
      await scenario.cleanup();
    }
  });

  test("composer accepts dropped files through the attachment pipeline", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendPrompt(page, "Start a drag and drop loom.");
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      const uploadResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/attachments") &&
          response.status() === 201
      );
      await dropFilesOnComposer(page, [
        {
          name: "drop-sleep-notes.md",
          mimeType: "text/markdown",
          content: "Dropped notes mention sleep deprivation and memory consolidation.",
        },
      ]);
      await uploadResponse;
      await expect(page.getByTestId("attachment-token-drop-sleep-notes.md")).toContainText(
        "Ready",
        { timeout: 15_000 }
      );

      await sendPrompt(page, "Use the dropped file.");
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });
      await expectSingleSentAttachmentChip(page, "drop-sleep-notes.md");
    } finally {
      await scenario.cleanup();
    }
  });

  test("composer accepts multi-file drop with stable chip rows", async ({ page }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    try {
      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      await sendPrompt(page, "Start a multi file drop loom.");
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      const uploads = ["drop-one.md", "drop-two.md", "drop-three.md"].map((name) =>
        page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            response.url().includes("/attachments") &&
            response.status() === 201 &&
            Boolean(response.request().postData()?.includes(name))
        )
      );
      await dropFilesOnComposer(page, [
        { name: "drop-one.md", mimeType: "text/markdown", content: "first dropped file" },
        { name: "drop-two.md", mimeType: "text/markdown", content: "second dropped file" },
        { name: "drop-three.md", mimeType: "text/markdown", content: "third dropped file" },
      ]);
      await Promise.all(uploads);
      await expect(page.locator(".file-attachment-chip")).toHaveCount(3, { timeout: 15_000 });
      await expect(page.getByTestId("attachment-token-drop-one.md")).toContainText("Ready");
      await expect(page.getByTestId("attachment-token-drop-two.md")).toContainText("Ready");
      await expect(page.getByTestId("attachment-token-drop-three.md")).toContainText("Ready");

      await sendPrompt(page, "Send all dropped files.");
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });
      await expectSentAttachmentTray(page, ["drop-one.md", "drop-two.md", "drop-three.md"]);
    } finally {
      await scenario.cleanup();
    }
  });
});
