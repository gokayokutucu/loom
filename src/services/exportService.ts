/*
 * Legacy/dev/test-only export composition after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function textToBase64(content: string) {
  return bytesToBase64(new TextEncoder().encode(content));
}

let crc32Lookup: Uint32Array | null = null;

function getCrc32Lookup() {
  if (crc32Lookup) return crc32Lookup;
  const lookup = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    lookup[index] = value >>> 0;
  }
  crc32Lookup = lookup;
  return lookup;
}

function crc32(bytes: Uint8Array) {
  const lookup = getCrc32Lookup();
  let checksum = 0xffffffff;
  bytes.forEach((byte) => {
    checksum = lookup[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  });
  return (checksum ^ 0xffffffff) >>> 0;
}

function writeUint16(bytes: number[], value: number) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(bytes: number[], value: number) {
  bytes.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  );
}

function writeBytes(output: number[], bytes: Uint8Array) {
  bytes.forEach((byte) => output.push(byte));
}

function buildZipArchive(files: Array<{ name: string; bytes: Uint8Array }>) {
  const encoder = new TextEncoder();
  const output: number[] = [];
  const centralDirectory: number[] = [];

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const checksum = crc32(file.bytes);
    const localHeaderOffset = output.length;

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, checksum);
    writeUint32(output, file.bytes.length);
    writeUint32(output, file.bytes.length);
    writeUint16(output, nameBytes.length);
    writeUint16(output, 0);
    writeBytes(output, nameBytes);
    writeBytes(output, file.bytes);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, checksum);
    writeUint32(centralDirectory, file.bytes.length);
    writeUint32(centralDirectory, file.bytes.length);
    writeUint16(centralDirectory, nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, localHeaderOffset);
    writeBytes(centralDirectory, nameBytes);
  });

  const centralDirectoryOffset = output.length;
  output.push(...centralDirectory);
  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, files.length);
  writeUint16(output, files.length);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralDirectoryOffset);
  writeUint16(output, 0);

  return new Uint8Array(output);
}

export function exportLoomAsZip(input: LoomExportInput) {
  const encoder = new TextEncoder();
  return bytesToBase64(
    buildZipArchive([
      { name: "metadata.json", bytes: encoder.encode(exportLoomMetadataJson(input)) },
      { name: "loom.md", bytes: encoder.encode(exportLoomAsMarkdown(input)) },
      { name: "responses.csv", bytes: encoder.encode(exportLoomAsCsv(input)) },
    ])
  );
}

export function base64ToBlob(contentBase64: string, type: string) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type });
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

export function downloadBase64File(filename: string, contentBase64: string, type: string) {
  downloadBlobFile(filename, base64ToBlob(contentBase64, type));
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
