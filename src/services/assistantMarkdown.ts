import type { ResponseItem } from "../types";

export type AssistantMarkdownBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "thematicBreak" }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; code: string; closed: boolean }
  | {
      kind: "table";
      headers: string[];
      align: Array<"left" | "center" | "right" | undefined>;
      rows: string[][];
    };

const rawThinkingKeyPattern =
  /\b(raw_thinking|thinking_text|chain_of_thought|hidden_reasoning)\b/i;

export function responseMarkdownSource(response: Pick<ResponseItem, "answer" | "finalContent">) {
  return response.finalContent !== undefined ? response.finalContent : response.answer.join("\n\n");
}

export function normalizeAssistantMarkdownSource(markdown: string) {
  return cleanOrphanMarkdownMarkers(repairCollapsedMarkdownTables(markdown));
}

export function containsForbiddenThinkingKey(value: string) {
  return rawThinkingKeyPattern.test(value);
}

export function sanitizeAssistantMarkdownSource(markdown: string) {
  if (!containsForbiddenThinkingKey(markdown)) return markdown;
  return markdown
    .split("\n")
    .filter((line) => !containsForbiddenThinkingKey(line))
    .join("\n");
}

export function sanitizeAssistantMarkdownForRenderedCopy(markdown: string) {
  return normalizeAssistantMarkdownSource(sanitizeAssistantMarkdownSource(markdown));
}

export function buildAssistantCopyPayload(markdown: string) {
  const renderedMarkdown = sanitizeAssistantMarkdownForRenderedCopy(markdown);
  return {
    markdown: sanitizeAssistantMarkdownSource(markdown),
    html: assistantMarkdownToSafeHtml(renderedMarkdown),
    plainText: assistantMarkdownToPlainText(renderedMarkdown),
  };
}

export function buildAssistantDefaultCopyPayload(markdown: string) {
  const renderedMarkdown = sanitizeAssistantMarkdownForRenderedCopy(markdown);
  return {
    html: assistantMarkdownToSafeHtml(renderedMarkdown),
    plainText: assistantMarkdownToPlainText(renderedMarkdown),
  };
}

export function buildAssistantDefaultClipboardData(markdown: string) {
  const payload = buildAssistantDefaultCopyPayload(markdown);
  return {
    payload,
    clipboardData: {
      "text/html": new Blob([payload.html], { type: "text/html" }),
      "text/plain": new Blob([payload.plainText], { type: "text/plain" }),
    },
  };
}

export function buildAssistantRichClipboardData(markdown: string) {
  return buildAssistantDefaultClipboardData(markdown);
}

export function repairCollapsedMarkdownTables(markdown: string) {
  const lines = markdown.split("\n");
  let inCodeBlock = false;
  return lines
    .flatMap((line) => {
      if (line.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        return [line];
      }
      if (inCodeBlock) return [line];
      return splitCollapsedTableLine(line) ?? [line];
    })
    .join("\n");
}

export function cleanOrphanMarkdownMarkers(markdown: string) {
  const lines = markdown.split("\n");
  const cleanedLines: string[] = [];
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      cleanedLines.push(line);
      continue;
    }
    if (inCodeBlock) {
      cleanedLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    const orphanHeadingMatch = trimmed.match(/^(#{1,6})$/);
    if (orphanHeadingMatch) {
      const nextTextLineIndex = findNextNonEmptyLineIndex(lines, index + 1);
      if (nextTextLineIndex !== null && isPlainHeadingTextLine(lines[nextTextLineIndex])) {
        const nextLine = lines[nextTextLineIndex];
        cleanedLines.push(`${orphanHeadingMatch[1]} ${nextLine.trim()}`);
        index = nextTextLineIndex;
      }
      continue;
    }
    if (/^(?:-{3,}|_{3,}|\*{3,})\s+#{1,6}$/.test(trimmed)) continue;

    cleanedLines.push(line.replace(/\s+#{1,6}\s*$/, ""));
  }

  return cleanedLines.join("\n");
}

function findNextNonEmptyLineIndex(lines: string[], startIndex: number) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index].trim()) return index;
  }
  return null;
}

function isPlainHeadingTextLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("```")) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return false;
  if (/^(?:#{1,6}|-{3,}|_{3,}|\*{3,})$/.test(trimmed)) return false;
  if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) return false;
  if (isMarkdownTableLine(trimmed)) return false;
  return true;
}

function splitCollapsedTableLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  if (!/\|\s*:?-{3,}:?\s*\|/.test(trimmed)) return null;

  const parts = trimmed.split(/\|\s+\|/);
  if (parts.length < 3) return null;

  const rows = parts.map((part, index) => {
    let row = part.trim();
    if (!row.startsWith("|")) row = `| ${row}`;
    if (!row.endsWith("|")) row = `${row} |`;
    if (index > 0 && !row.startsWith("| ")) row = row.replace(/^\|/, "| ");
    return row;
  });

  if (!rows.every(isMarkdownTableLine)) return null;
  const alignmentIndex = rows.findIndex(isTableAlignmentLine);
  if (alignmentIndex <= 0) return null;

  return rows;
}

function isMarkdownTableLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  return tableCells(trimmed).length >= 2;
}

function isTableAlignmentLine(line: string) {
  const cells = tableCells(line);
  return cells.length >= 2 && cells.every(isTableAlignmentCell);
}

function isTableAlignmentCell(cell: string) {
  return /^:?-{1,}:?$/.test(cell.trim());
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseTableAlignment(line: string) {
  return tableCells(line).map((cell) => {
    const value = cell.trim();
    if (value.startsWith(":") && value.endsWith(":")) return "center" as const;
    if (value.endsWith(":")) return "right" as const;
    if (value.startsWith(":")) return "left" as const;
    return undefined;
  });
}

function isMarkdownThematicBreak(line: string) {
  const trimmed = line.trim();
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed);
}

export function parseAssistantMarkdown(markdown: string): AssistantMarkdownBlock[] {
  const blocks: AssistantMarkdownBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let tableLines: string[] = [];
  let codeLines: string[] = [];
  let codeLanguage = "";
  let inCodeBlock = false;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ kind: "list", ordered: listOrdered, items: listItems });
    }
    listItems = [];
    listOrdered = false;
  };

  const flushParagraph = () => {
    flushList();
    const text = paragraphLines.join("\n").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraphLines = [];
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    if (tableLines.length >= 2 && isTableAlignmentLine(tableLines[1])) {
      flushParagraph();
      const headers = tableCells(tableLines[0]);
      const align = parseTableAlignment(tableLines[1]);
      const rows = tableLines.slice(2).map(tableCells);
      blocks.push({ kind: "table", headers, align, rows });
    } else {
      paragraphLines.push(...tableLines);
    }
    tableLines = [];
  };

  const flushCode = (closed: boolean) => {
    blocks.push({
      kind: "code",
      language: codeLanguage || "text",
      code: codeLines.join("\n"),
      closed,
    });
    codeLines = [];
    codeLanguage = "";
  };

  const normalizedLines = normalizeAssistantMarkdownSource(markdown)
    .replace(/(\S)\s+(#{1,6}\s+)/g, "$1\n$2")
    .replace(/(\S)\s+([-*]\s+\*\*)/g, "$1\n$2")
    .replace(/(\S)\s+(\d+\.\s+\*\*)/g, "$1\n$2")
    .split("\n");

  normalizedLines.forEach((line) => {
    const fenceMatch = line.match(/^```([A-Za-z0-9_+.-]*)\s*$/);
    if (fenceMatch) {
      flushTable();
      if (inCodeBlock) {
        flushCode(true);
        inCodeBlock = false;
        return;
      }
      flushParagraph();
      inCodeBlock = true;
      codeLanguage = fenceMatch[1] || "text";
      return;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }

    if (isMarkdownTableLine(line)) {
      flushList();
      tableLines.push(line);
      return;
    }

    flushTable();

    if (!line.trim()) {
      flushParagraph();
      return;
    }

    if (isMarkdownThematicBreak(line)) {
      flushParagraph();
      blocks.push({ kind: "thematicBreak" });
      return;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2].trim(),
      });
      return;
    }

    const unorderedListMatch = line.match(/^[-*]\s+(.+)$/);
    const orderedListMatch = line.match(/^\d+\.\s+(.+)$/);
    if (unorderedListMatch || orderedListMatch) {
      const ordered = Boolean(orderedListMatch);
      const itemText = (orderedListMatch?.[1] ?? unorderedListMatch?.[1] ?? "").trim();
      if (listItems.length > 0 && listOrdered !== ordered) flushList();
      if (paragraphLines.length > 0) flushParagraph();
      listOrdered = ordered;
      listItems.push(itemText);
      return;
    }

    flushList();
    paragraphLines.push(line);
  });

  if (inCodeBlock) {
    flushCode(false);
  } else {
    flushTable();
    flushParagraph();
  }

  return blocks;
}

export function assistantMarkdownToPlainText(markdown: string) {
  return parseAssistantMarkdown(markdown)
    .map((block) => {
      if (block.kind === "heading") return block.text;
      if (block.kind === "paragraph") return stripInlineMarkdown(block.text);
      if (block.kind === "thematicBreak") return "";
      if (block.kind === "list") return block.items.map((item) => stripInlineMarkdown(item)).join("\n");
      if (block.kind === "code") return block.code;
      const rows = [block.headers, ...block.rows];
      return rows.map((row) => row.map(stripInlineMarkdown).join("\t")).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function cleanMarkdownDisplayText(value?: string) {
  const normalized = normalizeAssistantMarkdownSource(value ?? "");
  if (!normalized.trim()) return "";
  return assistantMarkdownToPlainText(normalized)
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function assistantMarkdownToSafeHtml(markdown: string) {
  return parseAssistantMarkdown(markdown)
    .map((block) => {
      if (block.kind === "heading") {
        return `<h${block.level}>${renderInlineHtml(block.text)}</h${block.level}>`;
      }
      if (block.kind === "paragraph") return `<p>${renderInlineHtml(block.text)}</p>`;
      if (block.kind === "thematicBreak") return `<hr>`;
      if (block.kind === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${block.items
          .map((item) => `<li>${renderInlineHtml(item)}</li>`)
          .join("")}</${tag}>`;
      }
      if (block.kind === "code") {
        return `<pre><code>${escapeHtml(block.code)}</code></pre>`;
      }
      return `<table><thead><tr>${block.headers
        .map((header, index) => tableCellHtml("th", header, block.align[index]))
        .join("")}</tr></thead><tbody>${block.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell, index) => tableCellHtml("td", cell, block.align[index]))
              .join("")}</tr>`
        )
        .join("")}</tbody></table>`;
    })
    .join("");
}

function tableCellHtml(
  tag: "td" | "th",
  value: string,
  align: "left" | "center" | "right" | undefined
) {
  const alignAttribute = align ? ` style="text-align:${align}"` : "";
  return `<${tag}${alignAttribute}>${renderInlineHtml(value)}</${tag}>`;
}

function renderInlineHtml(value: string) {
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\[([^\]]+)\]\((loom:\/\/[^)\s]+)\))/g;
  let cursor = 0;
  let html = "";
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > cursor) html += escapeHtml(value.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      html += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    } else if (token.startsWith("**")) {
      html += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    } else {
      const label = match[2] ?? "";
      const address = match[3] ?? "";
      html += `<a href="${escapeHtmlAttribute(address)}" data-loom-reference-title="${escapeHtmlAttribute(
        label
      )}">${escapeHtml(label)}</a>`;
    }
    cursor = match.index + token.length;
  }

  if (cursor < value.length) html += escapeHtml(value.slice(cursor));
  return html;
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
