// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service prompt edit proof.
// - LEGACY_TYPESCRIPT_LOCAL for seeded prompt edit UI rendering tests below.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

interface ExportedResponse {
  responseId: string;
  loomId: string;
  role: "user" | "assistant";
  content: string;
  sequenceIndex: number;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

interface LoomExportJson {
  responses: ExportedResponse[];
}

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function openGraphLoom(page: Page) {
  await page.getByRole("button", { name: "Open Weft-aware Loom graph" }).click();
  await expect(page.locator('[data-response-id="r-site-map"]')).toBeVisible();
}

async function editPrompt(page: Page, responseId: string, nextPrompt: string) {
  await page.getByTestId(`edit-prompt-${responseId}`).click();
  const editor = page.getByLabel("Edit prompt text");
  await expect(editor).toBeVisible();
  await editor.fill(nextPrompt);
  await page.getByRole("button", { name: "Save" }).click();
}

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function exportedLoomResponses(
  scenario: Awaited<ReturnType<typeof createServiceTestHarness>>,
  loomId: string
) {
  const exported = await scenario.client.exportLoom({
    loomId,
    format: "json",
    includeMetadata: true,
    includeReferences: true,
    includeGraph: true,
  });
  const exportedJson = JSON.parse(
    Buffer.from(exported.contentBase64, "base64").toString("utf8")
  ) as LoomExportJson;
  return exportedJson.responses;
}

function expectNoForbiddenPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw_thinking");
  expect(serialized).not.toContain("thinking_text");
  expect(serialized).not.toContain("chain_of_thought");
  expect(serialized).not.toContain("hidden_reasoning");
}

test.describe("[product-service-backed] prompt edit product proof", () => {
  test("[product-service-backed] edits a persisted prompt through loom-service and marks the downstream assistant stale", async ({
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

      const originalPrompt = "Event Sourcing nedir? Kısaca anlat.";
      const editedPrompt = "Event Sourcing nedir? Avantajlarıyla birlikte anlat.";
      await sendMainPrompt(page, originalPrompt);
      await expect(page.getByText("Deterministic E2E provider").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;
      const beforeResponses = await exportedLoomResponses(scenario, loomId);
      const userBefore = beforeResponses.find(
        (response) => response.role === "user" && response.sequenceIndex === 0
      );
      const assistantBefore = beforeResponses.find(
        (response) => response.role === "assistant" && response.sequenceIndex === 1
      );
      expect(userBefore).toBeTruthy();
      expect(assistantBefore).toBeTruthy();
      expect(userBefore!.content).toBe(originalPrompt);
      const assistantContentBefore = assistantBefore!.content;

      await editPrompt(page, assistantBefore!.responseId, editedPrompt);

      const response = page.locator(`[data-response-id="${assistantBefore!.responseId}"]`);
      await expect(response.locator(".user-message")).toContainText(editedPrompt);
      await expect(response.locator(".stale-answer-notice")).toContainText(
        "Answer may be outdated after prompt edit."
      );

      const afterResponses = await exportedLoomResponses(scenario, loomId);
      const userAfter = afterResponses.find(
        (item) => item.responseId === userBefore!.responseId
      );
      const assistantAfter = afterResponses.find(
        (item) => item.responseId === assistantBefore!.responseId
      );
      expect(userAfter).toBeTruthy();
      expect(assistantAfter).toBeTruthy();
      expect(userAfter!.loomId).toBe(loomId);
      expect(userAfter!.role).toBe("user");
      expect(userAfter!.content).toBe(editedPrompt);
      expect(userAfter!.sequenceIndex).toBe(userBefore!.sequenceIndex);
      expect(userAfter!.metadata).toMatchObject({
        edited: true,
        editReason: "user_prompt_edit",
      });
      expect(userAfter!.metadata).toHaveProperty("editedAt");
      expect(userAfter!.metadata).toHaveProperty("source");
      expect(userAfter!.metadata).toHaveProperty("workflowRunId");

      expect(assistantAfter!.role).toBe("assistant");
      expect(assistantAfter!.content).toBe(assistantContentBefore);
      expect(assistantAfter!.sequenceIndex).toBe(assistantBefore!.sequenceIndex);
      expect(assistantAfter!.metadata).toMatchObject({
        stale: true,
        staleReason: "prompt_edited",
        staleSourceResponseId: userBefore!.responseId,
      });
      expect(assistantAfter!.metadata).toHaveProperty("staleAt");

      expectNoForbiddenPayload(afterResponses);
      await expect(response).not.toContainText("raw_thinking");
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("[product-service-backed] regenerates from an edited prompt through loom-service and preserves stale answer", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scenario = await createServiceTestHarness({
      deterministicProvider: "event-sourcing",
      startApp: true,
    });
    const regenerateUrls: string[] = [];

    try {
      await page.route(/\/responses\/[^/]+\/regenerate$/, async (route) => {
        regenerateUrls.push(route.request().url());
        await route.continue();
      });

      await page.goto(scenario.appUrl!);
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();

      const originalPrompt = "Event Sourcing nedir? Kısaca anlat.";
      const editedPrompt = "Event Sourcing nedir? Avantajlarıyla birlikte anlat.";
      await sendMainPrompt(page, originalPrompt);
      await expect(page.getByText("Deterministic E2E provider").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;
      const beforeResponses = await exportedLoomResponses(scenario, loomId);
      const userBefore = beforeResponses.find(
        (response) => response.role === "user" && response.sequenceIndex === 0
      );
      const oldAssistantBefore = beforeResponses.find(
        (response) => response.role === "assistant" && response.sequenceIndex === 1
      );
      expect(userBefore).toBeTruthy();
      expect(oldAssistantBefore).toBeTruthy();
      const oldAssistantContent = oldAssistantBefore!.content;

      await editPrompt(page, oldAssistantBefore!.responseId, editedPrompt);
      const staleResponse = page.locator(
        `[data-response-id="${oldAssistantBefore!.responseId}"]`
      );
      await expect(staleResponse.locator(".stale-answer-notice")).toContainText(
        "Answer may be outdated after prompt edit."
      );

      await staleResponse.getByRole("button", { name: "Regenerate from here" }).click();
      await expect(page.getByText("Avantajları audit edilebilirlik").first()).toBeVisible({
        timeout: 30_000,
      });
      expect(regenerateUrls).toHaveLength(1);
      expect(regenerateUrls[0]).toContain(
        `/responses/${encodeURIComponent(userBefore!.responseId)}/regenerate`
      );

      const afterResponses = await exportedLoomResponses(scenario, loomId);
      const editedUser = afterResponses.find(
        (response) => response.responseId === userBefore!.responseId
      );
      const oldAssistant = afterResponses.find(
        (response) => response.responseId === oldAssistantBefore!.responseId
      );
      const regeneratedAssistant = afterResponses.find(
        (response) =>
          response.role === "assistant" &&
          response.responseId !== oldAssistantBefore!.responseId &&
          response.content.includes("Avantajları audit edilebilirlik")
      );

      expect(editedUser).toBeTruthy();
      expect(oldAssistant).toBeTruthy();
      expect(regeneratedAssistant).toBeTruthy();
      expect(editedUser!.content).toBe(editedPrompt);
      expect(editedUser!.sequenceIndex).toBe(userBefore!.sequenceIndex);
      expect(oldAssistant!.content).toBe(oldAssistantContent);
      expect(oldAssistant!.metadata).toMatchObject({
        stale: true,
        staleReason: "prompt_edited",
        staleSourceResponseId: userBefore!.responseId,
      });
      expect(regeneratedAssistant!.loomId).toBe(loomId);
      expect(regeneratedAssistant!.sequenceIndex).toBeGreaterThan(
        oldAssistantBefore!.sequenceIndex
      );
      expect(regeneratedAssistant!.metadata).toMatchObject({
        source: "prompt_edit_regenerate",
        regeneratedFromUserResponseId: userBefore!.responseId,
        replacesStaleResponseId: oldAssistantBefore!.responseId,
      });
      expect(regeneratedAssistant!.metadata).toHaveProperty("workflowRunId");

      await expect(staleResponse.locator(".stale-answer-notice")).toContainText(
        "Answer may be outdated after prompt edit."
      );
      const regeneratedResponse = page.locator(
        `[data-response-id="${regeneratedAssistant!.responseId}"]`
      );
      await expect(regeneratedResponse).toContainText("Event Sourcing");
      await expect(regeneratedResponse).toContainText("Avantajları");
      await expect(regeneratedResponse.locator(".stale-answer-notice")).toHaveCount(0);

      expectNoForbiddenPayload(afterResponses);
      await expect(page.locator("body")).not.toContainText("raw_thinking");
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});

test.describe("[legacy-typescript-local] Prompt editing", () => {
  test("edits a sent prompt and marks the answer stale", async ({ page }) => {
    await openApp(page);
    await openGraphLoom(page);

    await editPrompt(
      page,
      "r-site-map",
      "What should the default Graph View demonstrate?\nPreserve readable hierarchy."
    );

    const response = page.locator('[data-response-id="r-site-map"]');
    await expect(response.locator(".user-message")).toContainText(
      "Preserve readable hierarchy."
    );
    await expect(response.locator(".stale-answer-notice")).toContainText(
      "Answer may be outdated after prompt edit."
    );
    await expect(response.getByRole("button", { name: "Regenerate from here" })).toBeDisabled();
    await expect(response.locator(".user-message")).toContainText(
      "What should the default Graph View demonstrate?"
    );
  });

  test("cancel restores the original prompt", async ({ page }) => {
    await openApp(page);
    await openGraphLoom(page);

    await page.getByTestId("edit-prompt-r-site-map").click();
    await page.getByLabel("Edit prompt text").fill("Discarded edit");
    await page.getByRole("button", { name: "Cancel" }).click();

    const response = page.locator('[data-response-id="r-site-map"]');
    await expect(response.locator(".user-message")).toContainText(
      "What should the default Graph View demonstrate?"
    );
    await expect(response.locator(".user-message")).not.toContainText("Discarded edit");
    await expect(response.locator(".stale-answer-notice")).toBeHidden();
  });

  test("preserves newlines and Reference metadata when saving", async ({ page }) => {
    await openApp(page);
    await openGraphLoom(page);

    await page.getByTestId("edit-prompt-r-evidence-map").click();
    await expect(page.locator(".prompt-edit-reference-row .sent-prompt-reference-token")).toBeVisible();
    await page.getByLabel("Edit prompt text").fill("Line one\nLine two");
    await page.getByRole("button", { name: "Save" }).click();

    const response = page.locator('[data-response-id="r-evidence-map"]');
    const promptText = await response.locator(".user-message p").innerText();
    expect(promptText).toContain("Line one\nLine two");
    await expect(response.locator(".sent-prompt-reference-token")).toBeVisible();
    await response.locator(".sent-prompt-reference-token").click();
    await expect(page.locator('[data-response-id="r-site-map"]')).toBeVisible();
  });
});
