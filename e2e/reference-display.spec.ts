// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service Reference proof.
// - LEGACY_TYPESCRIPT_LOCAL for seeded Reference token rendering tests below.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

interface ReferenceDto {
  referenceId: string;
  sourceLoomId?: string;
  sourceResponseId?: string;
  targetKind: string;
  targetId?: string;
  targetUri?: string;
  label?: string;
  selectedText?: string;
  fragmentHash?: string;
  metadata?: unknown;
}

interface ReferenceEnvelope {
  reference: ReferenceDto;
  reused?: boolean;
}

interface ReferenceListResponse {
  references: ReferenceDto[];
}

interface ServiceGraphProjection {
  edges: Array<{ kind: string; source: string; target: string; label?: string; metadata?: unknown }>;
}

async function openApp(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
  await page.goto("/");
  await expect(page.getByTestId("loom-sidebar")).toBeVisible();
}

async function sendMainPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function selectAssistantText(page: Page, text: string) {
  const selected = await page.evaluate((targetText) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = node.textContent ?? "";
      const index = value.indexOf(targetText);
      const element = node.parentElement;
      if (index >= 0 && element?.closest(".assistant-body")) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + targetText.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        element.closest("article")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, text);
  expect(selected).toBe(true);
}

function expectNoForbiddenPayload(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain("raw_thinking");
  expect(serialized).not.toContain("thinking_text");
  expect(serialized).not.toContain("chain_of_thought");
  expect(serialized).not.toContain("hidden_reasoning");
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

test.describe("[product-service-backed] Reference product proof", () => {
  test("[product-service-backed] creates, reuses, renders, sends, suggests, graphs, and exports Fragment References through loom-service", async ({
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

      await sendMainPrompt(
        page,
        "Event Sourcing nedir? nasıl kullanılır? Detaylı olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;

      await selectAssistantText(page, "Event Store");
      await page.getByRole("button", { name: "Add as Reference" }).click();
      await expect(page.getByText("Fragment Reference added")).toBeVisible();

      const token = page.getByTestId("inline-loom-token").last();
      await expect(token).toBeVisible();
      await expect(token).toContainText("[[Event Store]]");
      await expect(token).not.toContainText("reference-");
      await expect(token).not.toContainText("Group 1");
      await expect(token).not.toContainText("Group 2");
      await expect(token).toHaveAttribute("data-loom-selected-text", "Event Store");
      await expect(token).toHaveAttribute("data-loom-reference-mention-id", /reference-/);
      await expect(token).toHaveAttribute("data-loom-fragment-hash", /.+/);

      const listed = await scenario.fetchJson<ReferenceListResponse>(
        `/looms/${encodeURIComponent(loomId)}/references`
      );
      expect(listed.references).toHaveLength(1);
      const reference = listed.references[0];
      expect(reference).toMatchObject({
        sourceLoomId: loomId,
        targetKind: "fragment",
        selectedText: "Event Store",
        label: "Event Store",
      });
      expect(reference.sourceResponseId).toBeTruthy();
      expect(reference.fragmentHash).toBeTruthy();
      expect(reference.targetId).toBe(reference.sourceResponseId);
      expect(reference.targetUri).toContain("#fragment=");

      const duplicate = await scenario.fetchJson<ReferenceEnvelope>("/references", {
        method: "POST",
        body: JSON.stringify({
          sourceLoomId: reference.sourceLoomId,
          sourceResponseId: reference.sourceResponseId,
          targetKind: reference.targetKind,
          targetId: reference.targetId,
          targetUri: reference.targetUri,
          label: reference.label,
          selectedText: reference.selectedText,
          fragmentHash: reference.fragmentHash,
          metadata: reference.metadata ?? {},
        }),
      });
      expect(duplicate.reused).toBe(true);
      expect(duplicate.reference.referenceId).toBe(reference.referenceId);
      const afterDuplicate = await scenario.fetchJson<ReferenceListResponse>(
        `/looms/${encodeURIComponent(loomId)}/references`
      );
      expect(afterDuplicate.references).toHaveLength(1);

      await page.keyboard.insertText(" Bu referansı kullanarak CQRS ilişkisini açıkla.");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".sent-prompt-reference-token").last()).toContainText(
        "Event Store"
      );
      await expect(page.locator(".sent-prompt-reference-token").last()).not.toContainText(
        "reference-"
      );

      await expect(page.getByText("CQRS, Event Sourcing").last()).toBeVisible({
        timeout: 30_000,
      });
      const exported = await scenario.client.exportLoom({
        loomId,
        format: "json",
        includeMetadata: true,
        includeReferences: true,
        includeGraph: true,
      });
      const exportedJson = JSON.parse(
        Buffer.from(exported.contentBase64, "base64").toString("utf8")
      ) as { responses: Array<{ metadata?: unknown }>; references?: ReferenceDto[] };
      expect(exportedJson.references?.map((item) => item.referenceId)).toContain(
        reference.referenceId
      );
      expect(JSON.stringify(exportedJson.responses)).toContain(reference.referenceId);
      expect(JSON.stringify(exportedJson.responses)).toContain("Event Store");

      const graph = await scenario.fetchJson<ServiceGraphProjection>(
        `/looms/${encodeURIComponent(loomId)}/graph?includeReferences=true`
      );
      expect(graph.edges.some((edge) => edge.kind === "reference")).toBe(true);

      const suggestions = await scenario.client.suggestReferences({
        loomId,
        draftText: "Event Store ve CQRS ilişkisi",
        limit: 5,
      });
      expect(suggestions.suggestions.map((suggestion) => suggestion.reference.referenceMentionId))
        .toContain(reference.referenceId);

      expectNoForbiddenPayload(listed);
      expectNoForbiddenPayload(duplicate);
      expectNoForbiddenPayload(afterDuplicate);
      expectNoForbiddenPayload(graph);
      expectNoForbiddenPayload(exportedJson);
      await expect(page.locator(".sent-prompt-reference-token").last()).not.toContainText(
        "raw_thinking"
      );

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

test.describe("[legacy-typescript-local] Reference display tokens", () => {
  test("global Reference display setting applies to newly inserted tokens", async ({
    page,
  }) => {
    await openApp(page);

    await page.getByTestId("profile-menu-trigger").click();
    await page.getByTestId("open-app-settings").click();
    await page.getByRole("button", { name: /UI Preferences/ }).click();
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
    await page.waitForTimeout(800);
    await expect(hint).toHaveCount(0);
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
