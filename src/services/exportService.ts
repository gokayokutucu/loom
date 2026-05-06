import type { Conversation, LoomLink, ResponseItem } from "../types";

export interface LoomExportInput {
  loom: Conversation;
  responses: ResponseItem[];
  exportedAt?: Date;
}

function safeText(value: string | undefined) {
  return value?.trim() ?? "";
}

function loomCode(loom: Conversation) {
  return safeText(loom.meta?.code);
}

function loomUri(loom: Conversation) {
  return safeText(loom.meta?.canonicalUri) || loom.path;
}

function responseCode(response: ResponseItem) {
  return safeText(response.meta?.code);
}

function responseUri(response: ResponseItem) {
  return safeText(response.meta?.canonicalUri);
}

function referencesMarkdown(links: LoomLink[]) {
  return links
    .map((link) => {
      const title = safeText(link.referenceCustomLabel) || safeText(link.title) || link.path;
      const address = safeText(link.canonicalUri) || link.path;
      return `- [${title}](${address})`;
    })
    .join("\n");
}

function escapeCsv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function csvRow(values: string[]) {
  return values.map(escapeCsv).join(",");
}

export function exportLoomAsMarkdown({ loom, responses, exportedAt = new Date() }: LoomExportInput) {
  const lines = [
    `# ${loom.title}`,
    "",
    `Loom: ${loomCode(loom) || "Unassigned"}`,
    `Address: ${loomUri(loom)}`,
    `Exported: ${exportedAt.toISOString()}`,
    "",
  ];

  responses.forEach((response) => {
    lines.push("## User", "", response.question, "");
    const code = responseCode(response);
    lines.push(`## Assistant${code ? ` — ${code}` : ""}`, "", response.answer.join("\n\n"), "");
    const canonicalUri = responseUri(response);
    if (canonicalUri) lines.push(`Address: ${canonicalUri}`, "");
    const references = referencesMarkdown([
      ...response.bookmarkedLinks,
      ...response.suggestedLinks,
    ]);
    if (references) lines.push("References:", "", references, "");
  });

  return lines.join("\n").trimEnd() + "\n";
}

export function exportLoomAsCsv({ loom, responses, exportedAt = new Date() }: LoomExportInput) {
  const header = [
    "loom_code",
    "loom_title",
    "loom_uri",
    "response_code",
    "role",
    "title",
    "content",
    "canonical_uri",
    "created_at",
    "keywords",
    "references",
  ];
  const rows = [csvRow(header)];
  const base = [loomCode(loom), loom.title, loomUri(loom)];

  responses.forEach((response) => {
    const references = [...response.bookmarkedLinks, ...response.suggestedLinks]
      .map((link) => safeText(link.canonicalUri) || link.path)
      .filter(Boolean)
      .join("; ");
    rows.push(
      csvRow([
        ...base,
        "",
        "user",
        response.question,
        response.question,
        "",
        exportedAt.toISOString(),
        "",
        references,
      ])
    );
    rows.push(
      csvRow([
        ...base,
        responseCode(response),
        "assistant",
        response.title,
        response.answer.join("\n\n"),
        responseUri(response),
        exportedAt.toISOString(),
        response.meta?.keywords.join("; ") ?? "",
        references,
      ])
    );
  });

  return rows.join("\n") + "\n";
}

export function exportLoomMetadataJson({ loom, responses, exportedAt = new Date() }: LoomExportInput) {
  const referenceCount = responses.reduce(
    (count, response) => count + response.bookmarkedLinks.length + response.suggestedLinks.length,
    0
  );
  return JSON.stringify(
    {
      loomId: loom.id,
      loomCode: loomCode(loom) || null,
      loomTitle: loom.title,
      canonicalUri: loomUri(loom),
      exportedAt: exportedAt.toISOString(),
      responseCount: responses.length,
      referenceCount,
    },
    null,
    2
  );
}

export function safeExportFilename(loom: Conversation, extension: "md" | "csv" | "json" | "zip") {
  const slug =
    loom.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "loom";
  const code = loomCode(loom);
  return `${slug}${code ? `-${code}` : ""}.${extension}`;
}

export function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  downloadBlobFile(filename, blob);
}

export function downloadBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
