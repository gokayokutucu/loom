// E2E data authority classification:
// - PRODUCT_SERVICE_BACKED: temp SQLite DB, fresh loom-service binary, product UI flow.
import { expect, type Page, test } from "@playwright/test";
import { createServiceTestHarness } from "./helpers/serviceTestHarness";

async function sendPrompt(page: Page, prompt: string) {
  const editor = page.getByRole("textbox", { name: "Prompt" }).first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function openAttachMenu(page: Page) {
  await page.getByRole("button", { name: "Attach" }).click();
  const menu = page.getByRole("dialog", { name: "Attach content" });
  await expect(menu).toBeVisible();
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

const eventNotes = {
  name: "event-notes.md",
  mimeType: "text/markdown",
  buffer: Buffer.from(
    "Event Sourcing uses an Event Store and CQRS. Replay rebuilds projections.",
    "utf8"
  ),
};

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

const selectablePdf = Buffer.from(
  "%PDF-1.4\n%%Page: 1 1\n1 0 obj <<>> stream\nBT (Selectable PDF attachment text for Loom includes enough meaningful words about Event Sourcing, projections, replay, commands, queries, auditability, consistency, and context retrieval to pass density classification.) Tj ET\nendstream\nendobj\n%%EOF",
  "utf8"
);

const scannedLikePdf = Buffer.from(
  "%PDF-1.4\n%%Page: 1 1\n/Subtype /Image\n/image-only\n%%EOF",
  "utf8"
);
const docxNotes = {
  name: "event-notes.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: createDocxFixture([
    ["Event Sourcing Notes", "Heading1"],
    ["DOCX context says Event Store replay rebuilds Loom projections.", null],
  ]),
};
const xlsxNotes = {
  name: "event-budget.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: createXlsxFixture([
    {
      name: "Planning",
      rows: [
        ["Topic", "Detail"],
        ["Event Store", "Replay rebuilds projections"],
        ["CQRS", "Separates commands and queries"],
      ],
    },
  ]),
};
const oversizedAttachment = Buffer.alloc(25 * 1024 * 1024 + 1, "x");

test.describe("[product-service-backed] Attachment reference UI flow", () => {
  test("Files tab owns upload while attachment tokens explicitly control prompt context", async ({
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
      await sendPrompt(page, "Create a short placeholder Loom.");
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      let menu = await openAttachMenu(page);
      await expect(menu.getByRole("tab", { name: "All" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      await expect(menu.getByRole("button", { name: "Attach local file" })).toHaveCount(0);
      await menu.getByRole("tab", { name: "Files" }).click();
      await expect(menu.getByRole("button", { name: "Attach local file" })).toBeVisible();

      await page.locator(".attach-content-dropdown input[type='file']").setInputFiles({
        name: "too-large.txt",
        mimeType: "text/plain",
        buffer: oversizedAttachment,
      });
      await expect(menu.locator(".linked-reference-error")).toContainText(
        "File is too large. Files can be up to 25 MB."
      );
      await expect(page.getByTestId("attachment-token-too-large.txt")).toHaveCount(0);

      await uploadFile(page, eventNotes);
      await expect(menu.locator(".attach-file-row", { hasText: eventNotes.name })).toContainText(
        "Ready"
      );
      await expect(page.getByTestId(`attachment-token-${eventNotes.name}`)).toContainText(
        eventNotes.name
      );

      await page.keyboard.press("Escape");
      await sendPrompt(page, "tablo avantaj dezavantaj");
      await expect(page.locator(".assistant-message").last()).toContainText(
        "Konu bağlamı bulunamadı.",
        { timeout: 30_000 }
      );

      menu = await openAttachMenu(page);
      await menu.getByRole("tab", { name: "Files" }).click();
      await uploadFile(page, eventNotes);
      await expect(page.getByTestId(`attachment-token-${eventNotes.name}`)).toContainText(
        "Ready"
      );

      await page.keyboard.press("Escape");
      await page.getByTestId(`attachment-token-${eventNotes.name}`).click();
      await expect(page.locator(".inline-loom-token").last()).toContainText(eventNotes.name);
      await page.getByRole("textbox", { name: "Prompt" }).first().click();
      await page.keyboard.insertText(" tablo avantaj dezavantaj");
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.locator(".assistant-message").last()).toContainText("Event Store", {
        timeout: 30_000,
      });

      menu = await openAttachMenu(page);
      await menu.getByRole("tab", { name: "Files" }).click();
      await uploadFile(page, {
        name: "pixel.png",
        mimeType: "image/png",
        buffer: onePixelPng,
      });
      await expect(menu.locator(".attach-file-row", { hasText: "pixel.png" })).toContainText(
        "Unsupported"
      );
      await expect(page.getByTestId("attachment-token-pixel.png")).toContainText("Unsupported");
      await expect(page.getByTestId("attachment-token-pixel.png").locator("img")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByTestId("attachment-token-pixel.png").click();
      await expect(page.locator(".inline-loom-token", { hasText: "pixel.png" })).toHaveCount(0);

      menu = await openAttachMenu(page);
      await menu.getByRole("tab", { name: "Files" }).click();
      await uploadFile(page, {
        name: "archive.bin",
        mimeType: "application/octet-stream",
        buffer: Buffer.from([0, 1, 2, 3]),
      });
      await expect(menu.locator(".attach-file-row", { hasText: "archive.bin" })).toContainText(
        "Unsupported"
      );

      await uploadFile(page, {
        name: "selectable.pdf",
        mimeType: "application/pdf",
        buffer: selectablePdf,
      });
      await expect(menu.locator(".attach-file-row", { hasText: "selectable.pdf" })).toContainText(
        "Ready",
        { timeout: 30_000 }
      );

      await uploadFile(page, {
        name: "scan.pdf",
        mimeType: "application/pdf",
        buffer: scannedLikePdf,
      });
      await expect(menu.locator(".attach-file-row", { hasText: "scan.pdf" })).toContainText(
        "OCR needed",
        { timeout: 30_000 }
      );

      await uploadFile(page, docxNotes);
      await expect(menu.locator(".attach-file-row", { hasText: docxNotes.name })).toContainText(
        "Ready",
        { timeout: 30_000 }
      );
      await expect(page.getByTestId(`attachment-token-${docxNotes.name}`)).toContainText("Ready");

      await uploadFile(page, xlsxNotes);
      await expect(menu.locator(".attach-file-row", { hasText: xlsxNotes.name })).toContainText(
        "Ready",
        { timeout: 30_000 }
      );
      await expect(page.getByTestId(`attachment-token-${xlsxNotes.name}`)).toContainText("Ready");

      await page.keyboard.press("Escape");
      await page.getByTestId(`attachment-token-${docxNotes.name}`).click();
      await page.getByTestId(`attachment-token-${xlsxNotes.name}`).click();
      await expect(page.locator(".inline-loom-token", { hasText: docxNotes.name })).toBeVisible();
      await expect(page.locator(".inline-loom-token", { hasText: xlsxNotes.name })).toBeVisible();
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });

  test("composer attachment row is capped at ten files with horizontal overflow", async ({
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
      await sendPrompt(page, "Create another placeholder Loom.");
      await expect(page.locator(".qa-item")).toHaveCount(1, { timeout: 30_000 });

      const menu = await openAttachMenu(page);
      await menu.getByRole("tab", { name: "Files" }).click();
      await page.locator(".attach-content-dropdown input[type='file']").setInputFiles(
        Array.from({ length: 11 }, (_, index) => ({
          name: `note-${index + 1}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.from(`note ${index + 1}`, "utf8"),
        }))
      );

      await expect(page.locator(".file-attachment-chip")).toHaveCount(10, { timeout: 30_000 });
      await expect(page.getByTestId("attachment-token-note-10.txt")).toBeVisible();
      await expect(page.getByTestId("attachment-token-note-11.txt")).toHaveCount(0);
      await expect(menu.locator(".linked-reference-error")).toContainText(
        "You can attach up to 10 files."
      );

      const rowStyle = await page.locator(".attached-file-row").evaluate((element) => {
        const styles = window.getComputedStyle(element);
        return {
          flexWrap: styles.flexWrap,
          overflowX: styles.overflowX,
          scrollbarWidth: styles.scrollbarWidth,
        };
      });
      expect(rowStyle.flexWrap).toBe("nowrap");
      expect(rowStyle.overflowX).toBe("auto");
      expect(rowStyle.scrollbarWidth).toBe("none");
    } finally {
      const cleanup = await scenario.cleanup();
      expect(cleanup.serviceStopped).toBe(true);
      expect(cleanup.appStopped).toBe(true);
      expect(cleanup.tempDirRemoved).toBe(true);
      expect(cleanup.warnings).toEqual([]);
    }
  });
});

function createDocxFixture(paragraphs: Array<[string, string | null]>): Buffer {
  const body = paragraphs
    .map(([text, style]) => {
      const styleXml = style ? `<w:pPr><w:pStyle w:val="${xmlEscape(style)}"/></w:pPr>` : "";
      return `<w:p>${styleXml}<w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p>`;
    })
    .join("");
  return createStoredZip([
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    ],
    [
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ],
  ]);
}

function createXlsxFixture(
  sheets: Array<{ name: string; rows: string[][] }>
): Buffer {
  const workbookSheets = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )
    .join("");
  const entries: Array<[string, string]> = [
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
    ],
  ];
  sheets.forEach((sheet, sheetIndex) => {
    const rowsXml = sheet.rows
      .map((row, rowIndex) => {
        const rowNumber = rowIndex + 1;
        const cells = row
          .map((value, columnIndex) => {
            const reference = `${columnName(columnIndex)}${rowNumber}`;
            return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
          })
          .join("");
        return `<row r="${rowNumber}">${cells}</row>`;
      })
      .join("");
    entries.push([
      `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`,
    ]);
  });
  return createStoredZip(entries);
}

function createStoredZip(entries: Array<[string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function columnName(index: number): string {
  let remaining = index;
  let name = "";
  do {
    const remainder = remaining % 26;
    name = String.fromCharCode(65 + remainder) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return name;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
