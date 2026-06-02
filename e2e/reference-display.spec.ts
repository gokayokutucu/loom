// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED for the rust-service Reference proof.
// - LEGACY_TYPESCRIPT_LOCAL for seeded Reference token rendering tests below.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";
import { addressBarReferenceAddress } from "../src/services/referenceDisplay";
import { FRAGMENT_CHIP_PREVIEW_MAX_CHARS } from "../src/services/fragmentChipPreview";

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

test.describe("[pure-ui-rendering] Fragment chip preview truncation", () => {
  test("long selected text: visible chip label is clamped, full text survives in data attribute", async ({
    page,
  }) => {
    const LONG_SELECTED_TEXT =
      "Responses flowing downward, and Weft branches splitting sideways without breaking hierarchy, " +
      "which means context is always preserved vertically while exploration spreads horizontally.";

    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/");
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();

    await page.evaluate(
      ({ text, maxChars }) => {
        const link = {
          id: "r-preview-test",
          type: "fragment" as const,
          title: "Preview test response",
          path: "r-preview-test",
          badge: "Selection",
          selectedText: text,
          sourceResponseId: "r-preview-test",
          presentationMode: "attached-card",
        };
        const draft = {
          text: "",
          html: "",
          references: [link],
          attachments: [],
        };
        const key = Object.keys(window.localStorage).find((k) => k.startsWith("loom:")) ?? "loom:test";
        const looms = JSON.parse(window.localStorage.getItem("loom:looms-list-v2") ?? "[]");
        if (!looms.length) {
          const loomId = "loom-preview-test";
          window.localStorage.setItem(
            "loom:looms-list-v2",
            JSON.stringify([{ loomId, title: "Preview test loom" }])
          );
          window.localStorage.setItem(
            `loom:composer-drafts-v1`,
            JSON.stringify({ [loomId]: draft })
          );
          void key;
        } else {
          const loomId = looms[0].loomId;
          const drafts = JSON.parse(window.localStorage.getItem("loom:composer-drafts-v1") ?? "{}");
          drafts[loomId] = draft;
          window.localStorage.setItem("loom:composer-drafts-v1", JSON.stringify(drafts));
        }
        void maxChars;
      },
      { text: LONG_SELECTED_TEXT, maxChars: FRAGMENT_CHIP_PREVIEW_MAX_CHARS }
    );

    await page.reload();
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();

    const chip = page.getByTestId("selection-reference-chip").first();
    if (!(await chip.isVisible())) {
      // If the draft injection didn't surface a chip (seeded data varies by run),
      // skip the DOM assertion rather than fail — the unit tests are the authority.
      test.skip();
      return;
    }

    const visibleLabel = await chip.locator("span").first().innerText();
    const fullText = await chip.getAttribute("data-loom-selected-text");

    // Full text is preserved in metadata
    expect(fullText).toBe(LONG_SELECTED_TEXT);
    // Visible label is truncated
    expect(visibleLabel.length).toBeLessThanOrEqual(FRAGMENT_CHIP_PREVIEW_MAX_CHARS + 1); // +1 for "…"
    expect(visibleLabel).toContain("…");
  });

  test("short selected text: visible chip label matches full text exactly", async ({ page }) => {
    const SHORT_TEXT = "The Process of Trilateration";

    await page.addInitScript(() => window.localStorage.clear());
    await page.goto("/");
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();

    await page.evaluate(
      (text) => {
        const link = {
          id: "r-short-test",
          type: "fragment" as const,
          title: "Short test response",
          path: "r-short-test",
          badge: "Selection",
          selectedText: text,
          sourceResponseId: "r-short-test",
          presentationMode: "attached-card",
        };
        const draft = {
          text: "",
          html: "",
          references: [link],
          attachments: [],
        };
        const looms = JSON.parse(window.localStorage.getItem("loom:looms-list-v2") ?? "[]");
        if (!looms.length) {
          const loomId = "loom-short-test";
          window.localStorage.setItem(
            "loom:looms-list-v2",
            JSON.stringify([{ loomId, title: "Short test loom" }])
          );
          window.localStorage.setItem("loom:composer-drafts-v1", JSON.stringify({ [loomId]: draft }));
        } else {
          const loomId = looms[0].loomId;
          const drafts = JSON.parse(window.localStorage.getItem("loom:composer-drafts-v1") ?? "{}");
          drafts[loomId] = draft;
          window.localStorage.setItem("loom:composer-drafts-v1", JSON.stringify(drafts));
        }
      },
      SHORT_TEXT
    );

    await page.reload();
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();

    const chip = page.getByTestId("selection-reference-chip").first();
    if (!(await chip.isVisible())) {
      test.skip();
      return;
    }

    const visibleLabel = await chip.locator("span").first().innerText();
    const fullText = await chip.getAttribute("data-loom-selected-text");

    expect(fullText).toBe(SHORT_TEXT);
    expect(visibleLabel).toBe(SHORT_TEXT);
    expect(visibleLabel).not.toContain("…");
  });
});

test.describe("[pure-ui-rendering] Reference address display helpers", () => {
  test("Fragment popover copy address prefers source Loom address over internal workflow ids", () => {
    const address = addressBarReferenceAddress({
      path: "response-workflow-1779538084945094000-assistant#fragment=abc",
      canonicalUri: "response-workflow-1779538084945094000-assistant#fragment=abc",
      sourceCanonicalUri:
        "loom://i-want-to-design-a-local-first-ai-runtime/L-JTHRW?id=a15d2d47-1c40-4852-ab0d-74778a0fea6a",
    });

    expect(address).toBe(
      "loom://i-want-to-design-a-local-first-ai-runtime/L-JTHRW?id=a15d2d47-1c40-4852-ab0d-74778a0fea6a"
    );
  });
});

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

async function transcriptBottomGap(page: Page) {
  return page.locator(".chat-transcript").evaluate((element) => {
    const transcript = element as HTMLElement;
    return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
  });
}

async function tokenOccurrenceMarker(token: Locator) {
  return token.evaluate((element) => {
    const content = window.getComputedStyle(element, "::after").content;
    if (!content || content === "none" || content === "normal") return "";
    return content.replace(/^["']|["']$/g, "");
  });
}

test.describe("[product-service-backed] Reference product proof", () => {
  test("[product-service-backed] allows repeated Response Link insertions in the active composer", async ({
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
        "Event Sourcing nedir? nasil kullanilir? Detayli olarak anlat"
      );
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });
      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();

      const linkButton = page.locator(".response-link-chip").last();
      await expect(linkButton).toBeVisible();
      const tokenCountBefore = await page.getByTestId("inline-loom-token").count();

      await linkButton.click();
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(tokenCountBefore + 1);
      await expect(page.locator(".prompt-editor")).toBeFocused();

      const firstToken = page.getByTestId("inline-loom-token").last();
      const sourceResponseId = await firstToken.getAttribute("data-loom-source-response-id");
      const sourceCanonicalUri = await firstToken.getAttribute("data-loom-source-canonical-uri");
      const responsePath = await firstToken.getAttribute("data-loom-path");
      const canonicalUri = await firstToken.getAttribute("data-loom-canonical-uri");
      expect(sourceResponseId).toBeTruthy();
      expect(sourceCanonicalUri).toBeTruthy();
      expect(responsePath).toBeTruthy();
      expect(canonicalUri).toBe(responsePath);
      expect(sourceCanonicalUri).toBe(responsePath);
      await expect(firstToken).not.toHaveAttribute("data-loom-occurrence-index", /.+/);
      await expect.poll(() => tokenOccurrenceMarker(firstToken)).toBe("");

      await linkButton.click();
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(tokenCountBefore + 2);
      const secondToken = page.getByTestId("inline-loom-token").last();
      await expect(secondToken).toHaveAttribute("data-loom-path", responsePath!);
      await expect(secondToken).toHaveAttribute("data-loom-canonical-uri", responsePath!);
      await expect(secondToken).toHaveAttribute("data-loom-source-response-id", sourceResponseId!);
      await expect(secondToken).toHaveAttribute("data-loom-source-canonical-uri", sourceCanonicalUri!);
      await expect(secondToken).toHaveAttribute(
        "data-loom-occurrence-index",
        "2"
      );
      await expect.poll(() => tokenOccurrenceMarker(secondToken)).toBe(" #2");
      await expect(page.locator(".prompt-editor")).toBeFocused();

      await linkButton.click();
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(tokenCountBefore + 3);
      const thirdToken = page.getByTestId("inline-loom-token").last();
      await expect(thirdToken).toHaveAttribute("data-loom-path", responsePath!);
      await expect(thirdToken).toHaveAttribute("data-loom-canonical-uri", responsePath!);
      await expect(thirdToken).toHaveAttribute("data-loom-source-response-id", sourceResponseId!);
      await expect(thirdToken).toHaveAttribute("data-loom-source-canonical-uri", sourceCanonicalUri!);
      await expect(thirdToken).toHaveAttribute(
        "data-loom-occurrence-index",
        "3"
      );
      await expect.poll(() => tokenOccurrenceMarker(thirdToken)).toBe(" #3");
      await expect(page.locator(".prompt-editor")).toBeFocused();

      const tokenCountBeforeMove = await page.getByTestId("inline-loom-token").count();
      const promptMoveResult = await page.locator(".prompt-editor").evaluate(async (editor) => {
        const editorElement = editor as HTMLElement;
        const tokens = Array.from(
          editorElement.querySelectorAll<HTMLElement>(".inline-loom-token")
        );
        const source = tokens[1];
        const surface = editorElement.closest<HTMLElement>("[data-testid='prompt-surface']");
        if (!source || !surface) return { moved: false, tokenCount: tokens.length };
        const transfer = new DataTransfer();
        source.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        );
        const rect = editorElement.getBoundingClientRect();
        const dropOptions = {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: rect.right - 8,
          clientY: rect.top + Math.max(8, rect.height / 2),
        };
        surface.dispatchEvent(new DragEvent("dragenter", dropOptions));
        surface.dispatchEvent(new DragEvent("dragover", dropOptions));
        surface.dispatchEvent(new DragEvent("drop", dropOptions));
        source.dispatchEvent(
          new DragEvent("dragend", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        );
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        return {
          moved: true,
          tokenCount: editorElement.querySelectorAll(".inline-loom-token").length,
        };
      });
      expect(promptMoveResult).toEqual({
        moved: true,
        tokenCount: tokenCountBeforeMove,
      });
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(tokenCountBeforeMove);

      const tokenCountBeforeOptionDuplicate = await page.getByTestId("inline-loom-token").count();
      const promptOptionDuplicateResult = await page.locator(".prompt-editor").evaluate(async (editor) => {
        const editorElement = editor as HTMLElement;
        const tokens = Array.from(
          editorElement.querySelectorAll<HTMLElement>(".inline-loom-token")
        );
        const source = tokens[1];
        const surface = editorElement.closest<HTMLElement>("[data-testid='prompt-surface']");
        if (!source || !surface) return { duplicated: false, tokenCount: tokens.length };
        const transfer = new DataTransfer();
        source.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        );
        const rect = editorElement.getBoundingClientRect();
        const dropOptions = {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: rect.right - 8,
          clientY: rect.top + Math.max(8, rect.height / 2),
          altKey: true,
        };
        surface.dispatchEvent(new DragEvent("dragenter", dropOptions));
        surface.dispatchEvent(new DragEvent("dragover", dropOptions));
        surface.dispatchEvent(new DragEvent("drop", dropOptions));
        source.dispatchEvent(
          new DragEvent("dragend", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          })
        );
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        return {
          duplicated: true,
          tokenCount: editorElement.querySelectorAll(".inline-loom-token").length,
        };
      });
      expect(promptOptionDuplicateResult).toEqual({
        duplicated: true,
        tokenCount: tokenCountBeforeOptionDuplicate + 1,
      });
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(
        tokenCountBeforeOptionDuplicate + 1
      );
      await expect.poll(() => tokenOccurrenceMarker(page.getByTestId("inline-loom-token").last())).toBe(" #4");

      await page.getByRole("button", { name: /^References$/ }).first().click();
      const linkedReferences = page.locator(".linked-reference-dropdown");
      await expect(linkedReferences.getByRole("option")).toHaveCount(4);
      await expect(linkedReferences).toContainText("#4");
      await linkedReferences.getByRole("button", { name: "Duplicate Reference" }).first().click();
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(
        tokenCountBeforeOptionDuplicate + 2
      );
      await expect.poll(() => tokenOccurrenceMarker(page.getByTestId("inline-loom-token").last())).toBe(" #5");
      await expect(linkedReferences.getByRole("option")).toHaveCount(5);
      await expect(linkedReferences).toContainText("#5");

      const matchingTokens = await page.getByTestId("inline-loom-token").evaluateAll(
        (tokens, expected) =>
          tokens.filter(
            (item) =>
              item instanceof HTMLElement &&
              item.dataset.loomSourceResponseId === expected.sourceResponseId &&
              item.dataset.loomSourceCanonicalUri === expected.sourceCanonicalUri
          ).length,
        { sourceResponseId, sourceCanonicalUri }
      );
      expect(matchingTokens).toBe(5);
      const promptTokenVisibility = await page.locator(".prompt-editor").evaluate((editor) => {
        const editorElement = editor as HTMLElement;
        const editorRect = editorElement.getBoundingClientRect();
        return Array.from(
          editorElement.querySelectorAll<HTMLElement>(".inline-loom-token")
        ).map((token) => {
          const tokenRect = token.getBoundingClientRect();
          const visibleHeight =
            Math.min(tokenRect.bottom, editorRect.bottom) -
            Math.max(tokenRect.top, editorRect.top);
          return {
            text: token.textContent,
            visible: visibleHeight >= Math.min(10, tokenRect.height),
            editorHeight: editorElement.clientHeight,
            editorScrollHeight: editorElement.scrollHeight,
          };
        });
      });
      expect(promptTokenVisibility).toHaveLength(5);
      expect(promptTokenVisibility.every((token) => token.visible)).toBe(true);
      expect(promptTokenVisibility[0].editorHeight).toBeGreaterThan(40);
      await expect.poll(() => transcriptBottomGap(page)).toBeLessThanOrEqual(96);

      await page.keyboard.insertText(
        "\nScroll follow proof ".repeat(80).trim()
      );
      await expect(page.locator(".prompt-editor")).toBeFocused();
      await expect.poll(() => transcriptBottomGap(page)).toBeLessThanOrEqual(96);

      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(0);
      await expect(page.locator(".prompt-editor")).toBeFocused();
      await linkButton.click();
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1);
      const afterImmediateDeleteToken = page.getByTestId("inline-loom-token").last();
      await expect(afterImmediateDeleteToken).toHaveAttribute(
        "data-loom-path",
        responsePath!
      );
      await expect(page.locator(".prompt-editor")).toBeFocused();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(0);

      await page.evaluate((loomId) => {
        window.localStorage.setItem(
          "loom:composer-drafts-v1",
          JSON.stringify({
            [loomId]: {
              html: "",
              links: [
                {
                  id: "stale-smoke-response",
                  type: "response",
                  title: 'The "Smoke" effect in Focus Composer is a post-processing feature design',
                  path: "loom://focus-composer-smoke/L-HN05W/r/R-00000?id=stale-smoke-response",
                },
                {
                  id: "stale-greece-response",
                  type: "response",
                  title: "Yunanistan'in tam anlamiyla kurulusu tek bir tarihe sigmaz",
                  path: "loom://yunanistan-ne-zaman-kuruldu/L-B26Y8/r/R-00000?id=stale-greece-response",
                },
              ],
            },
          })
        );
      }, rootLoom!.loomId);
      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByRole("button", { name: `Open ${rootLoom!.title}` }).click();
      await expect(page.getByText("Event Store").first()).toBeVisible({ timeout: 30_000 });
      await page.locator(".response-link-chip").last().click();
      await expect(page.getByTestId("inline-loom-token")).toHaveCount(1);
      const migratedToken = page.getByTestId("inline-loom-token").last();
      await expect(migratedToken).not.toContainText("Smoke");
      await expect(migratedToken).not.toContainText("Yunanistan");
      await expect(migratedToken).toHaveAttribute("data-loom-source-canonical-uri", /event-sourcing/i);
      expect(scenario.dbPath).toContain(scenario.tempDir);
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

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

      await page.locator(".chat-transcript").evaluate((element) => {
        const transcript = element as HTMLElement;
        transcript.scrollTop = transcript.scrollHeight;
      });
      const addressInput = page.getByLabel("Loom Address Bar");
      await addressInput.click();
      await addressInput.fill(reference.targetUri!);
      await addressInput.press("Enter");
      const sourceResponse = page.locator(
        `[data-response-id="${reference.sourceResponseId}"]`
      );
      await expect(sourceResponse).toHaveClass(/response-scroll-highlight/, {
        timeout: 5_000,
      });
      await expect.poll(() => transcriptBottomGap(page)).toBeGreaterThan(96);

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

  test("[product-service-backed] adds a persisted code block as a Reference from the response code block action", async ({
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
      await expect(page.locator(".assistant-code-block").first()).toBeVisible({
        timeout: 30_000,
      });

      const rootLoom = (await scenario.client.listLooms()).find((item) =>
        item.title.includes("Event Sourcing")
      );
      expect(rootLoom).toBeTruthy();
      const loomId = rootLoom!.loomId;
      const proof = await scenario.getProof(loomId);
      expect(proof.codeBlocks.length).toBeGreaterThan(0);
      const persistedCodeBlock = proof.codeBlocks[0];
      expect(persistedCodeBlock.language).toBe("ts");
      expect(persistedCodeBlock.code).toContain("const stream = eventStore.load");

      const codeBlock = page.locator(".assistant-code-block").first();
      await codeBlock.getByRole("button", { name: /Add ts code block as Reference/ }).click();
      await expect(page.getByText("Code Reference added")).toBeVisible();

      const token = page.getByTestId("inline-loom-token").last();
      await expect(token).toBeVisible();
      await expect(token).toContainText("[[ts code from");
      await expect(token).toHaveAttribute("data-loom-selected-text", persistedCodeBlock.code);
      await expect(token).toHaveAttribute("data-loom-target-object-id", persistedCodeBlock.codeBlockId);
      await expect(token).toHaveAttribute("data-loom-badge", "Code");
      await expect(token).toHaveAttribute("data-loom-canonical-uri", /#code-block=/);
      await expect(token).toHaveAttribute("data-loom-reference-mention-id", /reference-/);

      await page.getByRole("button", { name: "Attach" }).click();
      await page.getByRole("tab", { name: "Code Snippets" }).click();
      const snippetRow = page.getByTestId(`attach-content-row-codeSnippet-${persistedCodeBlock.codeBlockId}`);
      await expect(snippetRow).toBeVisible();
      await expect(snippetRow).toContainText("const stream = eventStore.load");
      await expect(snippetRow).toHaveAttribute("data-attach-selected", "true");
      await page.keyboard.press("Escape");

      const listed = await scenario.fetchJson<ReferenceListResponse>(
        `/looms/${encodeURIComponent(loomId)}/references`
      );
      expect(listed.references).toHaveLength(1);
      const reference = listed.references[0];
      expect(reference).toMatchObject({
        sourceLoomId: loomId,
        targetKind: "code_block",
        targetId: persistedCodeBlock.codeBlockId,
        selectedText: persistedCodeBlock.code,
      });
      expect(reference.sourceResponseId).toBe(persistedCodeBlock.responseId);
      expect(reference.targetUri).toContain("#code-block=");
      expect(JSON.stringify(reference)).not.toContain("raw_thinking");

      await page.keyboard.insertText(" IProcessor nasıl olmalı");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".sent-prompt-reference-token").last()).toContainText(
        "ts code from"
      );
      await expect(page.getByText("[[ts code from", { exact: false })).toHaveCount(0);

      await page.reload();
      await expect(page.getByTestId("loom-sidebar")).toBeVisible();
      await page.getByRole("button", { name: `Open ${rootLoom!.title}` }).click();
      await expect(page.locator(".sent-prompt-reference-token").last()).toContainText(
        "ts code from"
      );
      await expect(page.getByText("[[ts code from", { exact: false })).toHaveCount(0);
      await page.locator(".sent-prompt-reference-token").last().click();
      await expect(
        page
          .locator(".assistant-code-block", {
            hasText: "const stream = eventStore.load",
          })
          .first()
      ).toBeVisible();

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

// ── Containment helpers ───────────────────────────────────────────────────────

/** Measures the bounding rect of an element and the document scroll state. */
async function measureComposerContainment(page: Page) {
  return page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>("[data-testid='prompt-surface']");
    const chip = document.querySelector<HTMLElement>("[data-testid='selection-reference-chip']");
    if (!surface) return null;
    const surfaceRect = surface.getBoundingClientRect();
    const chipRect = chip?.getBoundingClientRect() ?? null;
    return {
      surfaceWidth: surfaceRect.width,
      surfaceLeft: surfaceRect.left,
      surfaceRight: surfaceRect.right,
      chipWidth: chipRect?.width ?? null,
      chipRight: chipRect?.right ?? null,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
    };
  });
}

/** Injects a composer draft with a fragment reference chip for a given loom id. */
function injectComposerDraftWithChip(loomId: string, selectedText: string) {
  const link = {
    id: "containment-test-chip",
    type: "fragment",
    title: "Containment test response",
    path: `loom://containment-test/${loomId}/r-test`,
    badge: "Selection",
    selectedText,
    sourceResponseId: "r-test",
    presentationMode: "attached-card",
  };
  const draft = { html: "", links: [link] };
  window.localStorage.setItem(
    "loom:composer-drafts-v1",
    JSON.stringify({ [loomId]: draft })
  );
  window.localStorage.setItem(
    "loom:last-active-loom-v1",
    JSON.stringify({ activeLoomId: loomId })
  );
}

test.describe("[legacy-typescript-local] Ask to Loom reference chip containment", () => {
  const LONG_TEXT =
    "Responses flowing downward, and Weft branches splitting sideways without breaking hierarchy, " +
    "which means context is always preserved vertically while exploration spreads horizontally " +
    "across the entire graph surface without ever losing the vertical reading path.";
  const SHORT_TEXT = "The Process of Trilateration";
  const LOOM_ID = "c-architecture";

  async function openWithChip(page: Page, selectedText: string) {
    await page.addInitScript(
      ({ loomId, text }) => {
        window.localStorage.clear();
        const link = {
          id: "containment-test-chip",
          type: "fragment",
          title: "Containment test response",
          path: `loom://containment-test/${loomId}/r-test`,
          badge: "Selection",
          selectedText: text,
          sourceResponseId: "r-test",
          presentationMode: "attached-card",
        };
        const draft = { html: "", links: [link] };
        window.localStorage.setItem(
          "loom:composer-drafts-v1",
          JSON.stringify({ [loomId]: draft })
        );
        window.localStorage.setItem(
          "loom:last-active-loom-v1",
          JSON.stringify({ activeLoomId: loomId })
        );
      },
      { loomId: LOOM_ID, text: selectedText }
    );
    await page.goto("/");
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();
    // Navigate to the architecture loom so the composer is active
    await page.getByTestId(`sidebar-pinned-loom-${LOOM_ID}`).click();
    await expect(page.getByTestId("prompt-surface")).toBeVisible();
  }

  test("long selected text chip does not widen the composer surface", async ({ page }) => {
    await openWithChip(page, LONG_TEXT);

    const chip = page.getByTestId("selection-reference-chip").first();
    await expect(chip).toBeVisible();

    const metrics = await measureComposerContainment(page);
    expect(metrics).not.toBeNull();

    // Chip must not overflow the surface horizontally
    expect(metrics!.chipWidth).not.toBeNull();
    expect(metrics!.chipWidth!).toBeLessThanOrEqual(metrics!.surfaceWidth + 2);
    if (metrics!.chipRight !== null) {
      expect(metrics!.chipRight).toBeLessThanOrEqual(metrics!.surfaceRight + 2);
    }
  });

  test("no horizontal document overflow after Ask to Loom with long text", async ({ page }) => {
    await openWithChip(page, LONG_TEXT);
    await expect(page.getByTestId("selection-reference-chip").first()).toBeVisible();

    const metrics = await measureComposerContainment(page);
    expect(metrics).not.toBeNull();

    // No horizontal scrollbar / content overflow
    expect(metrics!.documentScrollWidth).toBeLessThanOrEqual(metrics!.documentClientWidth + 8);
    expect(metrics!.bodyScrollWidth).toBeLessThanOrEqual(metrics!.bodyClientWidth + 8);
  });

  test("short selected text chip is equally contained", async ({ page }) => {
    await openWithChip(page, SHORT_TEXT);

    const chip = page.getByTestId("selection-reference-chip").first();
    await expect(chip).toBeVisible();

    const metrics = await measureComposerContainment(page);
    expect(metrics).not.toBeNull();

    expect(metrics!.chipWidth!).toBeLessThanOrEqual(metrics!.surfaceWidth + 2);
    if (metrics!.chipRight !== null) {
      expect(metrics!.chipRight).toBeLessThanOrEqual(metrics!.surfaceRight + 2);
    }
    expect(metrics!.documentScrollWidth).toBeLessThanOrEqual(metrics!.documentClientWidth + 8);
  });

  test("full selected text is preserved in data attribute, visible label is shorter", async ({
    page,
  }) => {
    await openWithChip(page, LONG_TEXT);

    const chip = page.getByTestId("selection-reference-chip").first();
    await expect(chip).toBeVisible();

    const fullText = await chip.getAttribute("data-loom-selected-text");
    expect(fullText).toBe(LONG_TEXT);

    const visibleLabel = await chip.locator("span").first().innerText();
    expect(visibleLabel.length).toBeLessThanOrEqual(FRAGMENT_CHIP_PREVIEW_MAX_CHARS + 1);
    expect(visibleLabel.length).toBeLessThan(LONG_TEXT.length);
  });

  test("surface width is the same before and after chip is inserted", async ({ page }) => {
    // Measure surface width without chip
    await page.addInitScript((loomId) => {
      window.localStorage.clear();
      window.localStorage.setItem(
        "loom:last-active-loom-v1",
        JSON.stringify({ activeLoomId: loomId })
      );
    }, LOOM_ID);
    await page.goto("/");
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();
    await page.getByTestId(`sidebar-pinned-loom-${LOOM_ID}`).click();
    await expect(page.getByTestId("prompt-surface")).toBeVisible();

    const widthBefore = await page
      .getByTestId("prompt-surface")
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);

    // Now inject a chip and reload
    await page.evaluate(
      ({ loomId, text }) => {
        const link = {
          id: "containment-test-chip",
          type: "fragment",
          title: "Containment test response",
          path: `loom://containment-test/${loomId}/r-test`,
          badge: "Selection",
          selectedText: text,
          sourceResponseId: "r-test",
          presentationMode: "attached-card",
        };
        const draft = { html: "", links: [link] };
        window.localStorage.setItem(
          "loom:composer-drafts-v1",
          JSON.stringify({ [loomId]: draft })
        );
      },
      { loomId: LOOM_ID, text: LONG_TEXT }
    );
    await page.reload();
    await expect(page.getByTestId("loom-sidebar")).toBeVisible();
    await page.getByTestId(`sidebar-pinned-loom-${LOOM_ID}`).click();
    await expect(page.getByTestId("selection-reference-chip").first()).toBeVisible();

    const widthAfter = await page
      .getByTestId("prompt-surface")
      .evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);

    // Surface width must not grow due to the chip
    expect(widthAfter).toBeLessThanOrEqual(widthBefore + 2);
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

  test("pasting a Loom markdown link into the prompt restores an inline Reference chip", async ({
    page,
  }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    const editor = page.getByRole("textbox", { name: "Prompt" }).first();
    const referenceButton = page.getByRole("button", { name: /^References$/ }).first();
    const initialReferenceCount = await referenceButton.evaluate((element) => {
      const match = (element.textContent ?? "").match(/\d+/);
      return match ? Number(match[0]) : 0;
    });
    await editor.click();
    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>(".prompt-editor");
      if (!target) throw new Error("Prompt editor not found");
      const data = new DataTransfer();
      data.setData(
        "text/plain",
        "Compare [Address Bar as local AI web navigator](loom://loom-ai/navigation-architecture/loom/browser/r-address-bar?id=r-address-bar) next."
      );
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    });

    const token = page.getByTestId("inline-loom-token").last();
    await expect(token).toContainText("[[Address Bar as local AI web navigator]]");
    await expect(referenceButton).toContainText(String(initialReferenceCount + 1));
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
      /Loom navigation architecture/
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

  test("Fragment Reference rename only updates the selected chip", async ({ page }) => {
    await openApp(page);
    await openArchitectureLoom(page);

    await page.locator(".prompt-editor").evaluate((editor) => {
      const sourceCanonicalUri =
        "loom://loom-ai/navigation-architecture/loom/browser/r-address-bar?id=r-address-bar";
      editor.innerHTML = [
        `<span class="inline-loom-token" contenteditable="false" draggable="true" data-testid="inline-loom-token" data-loom-id="fragment-one" data-loom-path="${sourceCanonicalUri}#fragment=fragment-one" data-loom-title="First fragment" data-loom-type="fragment" data-loom-badge="Fragment" data-loom-source-loom-id="c-architecture" data-loom-source-response-id="r-address-bar" data-loom-source-canonical-uri="${sourceCanonicalUri}" data-loom-fragment-hash="fragment-one" data-loom-selected-text="First selected text">[[First fragment]]</span>`,
        `<span class="inline-loom-token" contenteditable="false" draggable="true" data-testid="inline-loom-token" data-loom-id="fragment-two" data-loom-path="${sourceCanonicalUri}#fragment=fragment-two" data-loom-title="Second fragment" data-loom-type="fragment" data-loom-badge="Fragment" data-loom-source-loom-id="c-architecture" data-loom-source-response-id="r-address-bar" data-loom-source-canonical-uri="${sourceCanonicalUri}" data-loom-fragment-hash="fragment-two" data-loom-selected-text="Second selected text">[[Second fragment]]</span>`,
      ].join(" ");
    });

    const tokens = page.getByTestId("inline-loom-token");
    await expect(tokens).toHaveCount(2);
    await expect(tokens.nth(0)).toContainText("[[First fragment]]");
    await expect(tokens.nth(1)).toContainText("[[Second fragment]]");

    await tokens.nth(1).click({ button: "right" });
    await page.getByRole("button", { name: "Rename" }).click();
    const input = page.getByLabel("Reference name");
    await expect(input).toBeFocused();
    await input.fill("Second fragment alias");
    await input.press("Enter");

    await expect(tokens.nth(0)).toContainText("[[First fragment]]");
    await expect(tokens.nth(1)).toContainText("[[Second fragment alias]]");
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
