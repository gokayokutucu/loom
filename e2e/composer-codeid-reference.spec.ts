// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
//
// Covers:
//   - # autocomplete can find a Response by its visible CodeID badge.
//   - Selecting the suggestion inserts a response reference chip, not raw CodeID text.
//   - Sent user-message metadata carries a response-level questionReference.
//   - Response footer Link remains equivalent for response identity fields.
import { expect, test, type Page } from "@playwright/test";

import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function getEditor(page: Page) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  return editor;
}

async function editorPlainTextOutsideReferenceChips(page: Page) {
  const editor = await getEditor(page);
  return editor.evaluate((el) => {
    const text: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.parentElement?.closest(".inline-loom-token")) {
        text.push(node.textContent ?? "");
      }
    }
    return text.join("");
  });
}

async function tokenDataset(page: Page) {
  const token = page.getByTestId("inline-loom-token").last();
  await expect(token).toBeVisible();
  return token.evaluate((el) => {
    const node = el as HTMLElement;
    return {
      id: node.dataset.loomId ?? "",
      type: node.dataset.loomType ?? "",
      path: node.dataset.loomPath ?? "",
      code: node.dataset.loomCode ?? "",
      sourceLoomId: node.dataset.loomSourceLoomId ?? "",
      sourceResponseId: node.dataset.loomSourceResponseId ?? "",
      canonicalUri: node.dataset.loomCanonicalUri ?? "",
    };
  });
}

test.describe("[product-service-backed] Composer Response CodeID references", () => {
  test("selecting #R-CodeID inserts a response reference and persists questionReferences", async ({
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

      const editor = await getEditor(page);
      await editor.click();
      await page.keyboard.insertText("Create a short CodeID reference source answer");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      const responseCodeBadge = page.locator(".response-code-badge").last();
      await expect(responseCodeBadge).toBeVisible();
      const visibleCode = (await responseCodeBadge.textContent())?.trim() ?? "";
      expect(visibleCode).toMatch(/^R-[A-Z0-9]{5,6}$/);
      const responseCodeTestId = await responseCodeBadge.getAttribute("data-testid");
      const sourceResponseId = responseCodeTestId?.replace(/^response-code-/, "") ?? "";
      expect(sourceResponseId).toBeTruthy();

      await editor.click();
      await page.keyboard.insertText(`#${visibleCode}`);
      const dropdown = page.getByTestId("reference-suggestion-dropdown");
      await expect(dropdown).toBeVisible();
      await expect(dropdown.getByRole("option").first()).toContainText(visibleCode);
      await expect(dropdown.getByRole("option").first()).toContainText("Response");
      await dropdown.getByRole("option").first().click();

      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1);
      const codeIdReferenceToken = await tokenDataset(page);
      expect(codeIdReferenceToken.type).toBe("response");
      expect(codeIdReferenceToken.code).toBe(visibleCode);
      expect(codeIdReferenceToken.sourceResponseId).toBe(sourceResponseId);
      expect(codeIdReferenceToken.path).toContain(sourceResponseId);
      expect(await editorPlainTextOutsideReferenceChips(page)).not.toContain(visibleCode);

      await editor.click();
      await page.keyboard.insertText(" Explain this referenced response.");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".qa-item")).toHaveCount(2, { timeout: 30_000 });

      const looms = await scenario.client.listLooms();
      const activeLoom = looms[0];
      expect(activeLoom).toBeTruthy();
      const activeLoomDetail = await scenario.fetchJson<{
        loom: {
          responses: Array<{
            role: string;
            content?: string;
            metadata?: { questionReferences?: Array<Record<string, unknown>> };
          }>;
        };
      }>(`/looms/${encodeURIComponent(activeLoom.loomId)}`);
      const followUpUserResponse = activeLoomDetail.loom.responses
        .filter((response) => response.role === "user")
        .find((response) => response.content?.includes("Explain this referenced response."));
      expect(followUpUserResponse).toBeTruthy();
      const questionReferences = followUpUserResponse?.metadata?.questionReferences ?? [];
      const responseReference = questionReferences.find(
        (reference) =>
          reference.type === "response" &&
          reference.sourceResponseId === sourceResponseId &&
          reference.referenceCode === visibleCode
      );
      expect(responseReference).toBeTruthy();

      await page.locator(".response-link-chip").first().click();
      const footerLinkToken = await tokenDataset(page);
      expect(footerLinkToken.type).toBe(codeIdReferenceToken.type);
      expect(footerLinkToken.code).toBe(codeIdReferenceToken.code);
      expect(footerLinkToken.path).toContain(visibleCode);
      expect(codeIdReferenceToken.path).toContain(visibleCode);
    } finally {
      await scenario.cleanup();
    }
  });
});
