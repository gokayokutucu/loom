// E2E data authority classification: PURE_UI_RENDERING.
// This spec tests Markdown/render/copy helpers and does not require service data.
import { expect, test } from "@playwright/test";
import {
  assistantMarkdownToPlainText,
  assistantMarkdownToSafeHtml,
  buildAssistantCopyPayload,
  buildAssistantDefaultClipboardData,
  buildAssistantDefaultCopyPayload,
  buildAssistantRichClipboardData,
  cleanMarkdownDisplayText,
  normalizeAssistantMarkdownSource,
  parseAssistantMarkdown,
  repairCollapsedMarkdownTables,
  responseMarkdownSource,
  sanitizeAssistantMarkdownForRenderedCopy,
  cleanOrphanMarkdownMarkers,
} from "../src/services/assistantMarkdown";
import type { ResponseItem } from "../src/types";

test.describe("[pure-ui-rendering] assistant Markdown rendering helpers", () => {
  test("parses GFM table blocks as tables", () => {
    const markdown = [
      "| Özellik | Açıklama |",
      "| :--- | :--- |",
      "| Tam Görünürlük | Tüm olay geçmişi izlenir. |",
      "| Mükemmel Uyumluluk | Denetim ve geri alma kolaylaşır. |",
    ].join("\n");

    const blocks = parseAssistantMarkdown(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "table",
      headers: ["Özellik", "Açıklama"],
      rows: [
        ["Tam Görünürlük", "Tüm olay geçmişi izlenir."],
        ["Mükemmel Uyumluluk", "Denetim ve geri alma kolaylaşır."],
      ],
    });
    expect(assistantMarkdownToSafeHtml(markdown)).toContain("<table>");
  });

  test("preserves streamed table newlines when chunks are accumulated", () => {
    const chunks = ["| A | B |\n", "| :--- | :--- |\n", "| x | y |\n"];
    const accumulated = chunks.reduce((current, chunk) => current + chunk, "");

    expect(accumulated).toBe("| A | B |\n| :--- | :--- |\n| x | y |\n");
    expect(parseAssistantMarkdown(accumulated)[0]).toMatchObject({
      kind: "table",
      headers: ["A", "B"],
      rows: [["x", "y"]],
    });
  });

  test("repairs common collapsed one-line Markdown table", () => {
    const repaired = repairCollapsedMarkdownTables("| A | B | | :--- | :--- | | x | y |");

    expect(repaired).toBe("| A | B |\n| :--- | :--- |\n| x | y |");
    expect(parseAssistantMarkdown(repaired)[0]).toMatchObject({
      kind: "table",
      rows: [["x", "y"]],
    });
  });

  test("repairs collapsed generated tables with loose separator cells", () => {
    const markdown =
      "| AWS Servisi | Başlangıç Maliyeti | Ortalama | Büyüme Maliyeti | |---------|-|-----------------|------| | EventStoreDB (EKS EC2) | ~$300 | ~$500 | ~$1000+ | | Amazon Kinesis | ~$10 | ~$100 | ~$500+ | | Amazon DynamoDB | ~$5 | ~$50 | ~$500+ | | Amazon QLDB | ~$100 | ~$300 | ~$1000+ | | AWS Lambda + S3 | ~$10 | ~$50 | ~$200+ |";
    const repaired = repairCollapsedMarkdownTables(markdown);
    const blocks = parseAssistantMarkdown(repaired);

    expect(repaired.split("\n")).toHaveLength(7);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "table",
      headers: ["AWS Servisi", "Başlangıç Maliyeti", "Ortalama", "Büyüme Maliyeti"],
      rows: [
        ["EventStoreDB (EKS EC2)", "~$300", "~$500", "~$1000+"],
        ["Amazon Kinesis", "~$10", "~$100", "~$500+"],
        ["Amazon DynamoDB", "~$5", "~$50", "~$500+"],
        ["Amazon QLDB", "~$100", "~$300", "~$1000+"],
        ["AWS Lambda + S3", "~$10", "~$50", "~$200+"],
      ],
    });
    expect(assistantMarkdownToSafeHtml(markdown)).toContain("<table>");
  });

  test("removes orphan Markdown heading markers produced around separators", () => {
    const markdown = [
      "AWS araçları şunlardır: ###",
      "",
      "| Çözüm | Açıklama |",
      "| :--- | :--- |",
      "| Kinesis | Event stream kaydetme |",
      "",
      "--- ###",
      "",
      "1. AWS Service Mimarisi Örneği",
      "",
      "```md",
      "--- ###",
      "```",
    ].join("\n");

    const normalized = normalizeAssistantMarkdownSource(markdown);

    expect(cleanOrphanMarkdownMarkers(markdown)).toContain("```md\n--- ###\n```");
    expect(normalized).toContain("AWS araçları şunlardır:");
    expect(normalized).toContain("| Çözüm | Açıklama |");
    expect(normalized).not.toContain("şunlardır: ###");
    expect(normalized.split("```md")[0]).not.toContain("--- ###");
    expect(parseAssistantMarkdown(markdown).some((block) => block.kind === "code" && block.code.includes("---"))).toBe(
      true
    );
  });

  test("normalizes Markdown display text for titles and previews", () => {
    const markdown = [
      "Loom: **AWS üzerinde Event Sourcing implementasyonu** için kullanılan araçlar ###",
      "",
      "--- ###",
      "",
      "1. **Event Store Seçenekleri**",
    ].join("\n");

    const displayText = cleanMarkdownDisplayText(markdown);

    expect(displayText).toContain("Loom: AWS üzerinde Event Sourcing implementasyonu");
    expect(displayText).toContain("Event Store Seçenekleri");
    expect(displayText).not.toContain("**");
    expect(displayText).not.toContain("###");
    expect(displayText).not.toContain("---");
  });

  test("does not repair pipe text inside fenced code", () => {
    const markdown = ["```text", "| A | B | | :--- | :--- | | x | y |", "```"].join("\n");

    expect(repairCollapsedMarkdownTables(markdown)).toBe(markdown);
    expect(parseAssistantMarkdown(markdown)[0]).toMatchObject({
      kind: "code",
      code: "| A | B | | :--- | :--- | | x | y |",
    });
  });

  test("Markdown copy source uses raw final content before rendered answer fragments", () => {
    const response: ResponseItem = {
      id: "r-1",
      title: "Table answer",
      address: "loom://demo/r-1",
      question: "Show a table",
      answer: ["rendered fallback"],
      finalContent: "| A | B |\n| :--- | :--- |\n| x | y |",
      suggestedLinks: [],
      bookmarkedLinks: [],
    };

    expect(responseMarkdownSource(response)).toBe("| A | B |\n| :--- | :--- |\n| x | y |");
    expect(normalizeAssistantMarkdownSource(responseMarkdownSource(response))).toBe(
      "| A | B |\n| :--- | :--- |\n| x | y |"
    );
  });

  test("plain text copy removes Markdown table syntax", () => {
    const markdown = "| A | B |\n| :--- | :--- |\n| **x** | `y` |";

    expect(assistantMarkdownToPlainText(markdown)).toBe("A\tB\nx\ty");
  });

  test("default copy payload uses rich HTML and clean plain text", () => {
    const markdown = [
      "# Başlık",
      "",
      "**Kalın** metin",
      "",
      "| A | B |",
      "| :--- | :--- |",
      "| x | y |",
    ].join("\n");

    const payload = buildAssistantDefaultCopyPayload(markdown);

    expect(payload.html).toContain("<h1>Başlık</h1>");
    expect(payload.html).toContain("<table>");
    expect(payload.plainText).toContain("Başlık");
    expect(payload.plainText).toContain("Kalın metin");
    expect(payload.plainText).toContain("A\tB\nx\ty");
    expect(payload.plainText).not.toContain("#");
    expect(payload.plainText).not.toContain("**");
    expect(payload.plainText).not.toContain("| :--- |");
  });

  test("default rich clipboard data does not expose Markdown source as plain payload", () => {
    const markdown = [
      "# Başlık",
      "",
      "**Kalın**",
      "",
      "| A | B |",
      "| :--- | :--- |",
      "| x | y |",
    ].join("\n");

    const { clipboardData, payload } = buildAssistantDefaultClipboardData(markdown);

    expect(Object.keys(clipboardData).sort()).toEqual(["text/html", "text/plain"]);
    expect(payload.plainText).toContain("Başlık");
    expect(payload.plainText).toContain("Kalın");
    expect(payload.plainText).toContain("A\tB\nx\ty");
    expect(payload.plainText).not.toContain("#");
    expect(payload.plainText).not.toContain("**");
    expect(payload.plainText).not.toContain("| :--- |");
  });

  test("explicit Markdown copy payload keeps raw Markdown source", () => {
    const markdown = [
      "# Başlık",
      "",
      "**Kalın**",
      "",
      "| A | B |",
      "| :--- | :--- |",
      "| x | y |",
    ].join("\n");

    expect(buildAssistantCopyPayload(markdown).markdown).toBe(markdown);
  });

  test("legacy rich clipboard alias stays clean and never exposes raw Markdown payload", () => {
    const markdown = "# Başlık\n\n**Kalın**\n\n| A | B |\n| :--- | :--- |\n| x | y |";
    const { payload, clipboardData } = buildAssistantRichClipboardData(markdown);

    expect(Object.keys(clipboardData).sort()).toEqual(["text/html", "text/plain"]);
    expect(payload).toEqual(buildAssistantDefaultCopyPayload(markdown));
    expect("markdown" in payload).toBe(false);
    expect(payload.plainText).toBe("Başlık\n\nKalın\n\nA\tB\nx\ty");
  });

  test("plain text copy removes common inline Markdown syntax", () => {
    const markdown = [
      "> # Başlık",
      "",
      "- **Kalın** ve [bağlantı](https://example.com)",
      "- ~~Silindi~~ ve _italik_",
    ].join("\n");

    const plain = assistantMarkdownToPlainText(markdown);

    expect(plain).toContain("Başlık");
    expect(plain).toContain("Kalın ve bağlantı");
    expect(plain).toContain("Silindi ve italik");
    expect(plain).not.toContain("#");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("https://example.com");
    expect(plain).not.toContain("~~");
  });

  test("plain text keeps code block content readable", () => {
    const markdown = ["```ts", "const value = a | b;", "```"].join("\n");

    expect(assistantMarkdownToPlainText(markdown)).toBe("const value = a | b;");
  });

  test("copy sanitization removes forbidden raw thinking metadata lines", () => {
    const markdown = [
      "Visible answer.",
      "raw_thinking: internal text that must not be copied",
      "| A | B | | :--- | :--- | | x | y |",
    ].join("\n");

    const payload = buildAssistantCopyPayload(markdown);
    const sanitized = sanitizeAssistantMarkdownForRenderedCopy(markdown);

    expect(payload.markdown).not.toContain("raw_thinking");
    expect(payload.plainText).not.toContain("raw_thinking");
    expect(payload.html).not.toContain("raw_thinking");
    expect(sanitized).toContain("| A | B |\n| :--- | :--- |\n| x | y |");
  });
});
