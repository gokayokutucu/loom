import type { CodeSnippetReferenceItem } from "../engine";
import { cleanMarkdownDisplayText } from "./assistantMarkdown";

const IDENTIFIER_PATTERNS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/, (match) => `function ${match[1]}`],
  [/^\s*(?:export\s+)?(?:class|interface|type|enum|struct|trait)\s+([A-Za-z_$][\w$]*)\b/, (match) => match[1]],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/, (match) => `const ${match[1]}`],
  [/^\s*(?:pub\s+)?fn\s+([A-Za-z_$][\w$]*)\b/, (match) => `fn ${match[1]}`],
  [/^\s*def\s+([A-Za-z_$][\w$]*)\b/, (match) => `def ${match[1]}`],
  [/^\s*<([A-Za-z][\w:.-]*)\b/, (match) => `<${match[1]}>`],
  [/^\s*"([^"]+)"\s*:/, (match) => `{ ${match[1]} }`],
];

export function codeSnippetFirstMeaningfulLine(code: string) {
  return (
    code
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "Code block"
  );
}

export function codeSnippetLanguageLabel(language?: string) {
  return language?.trim() || "text";
}

export function isMarkdownTableCodeSnippet(snippet: Pick<CodeSnippetReferenceItem, "code" | "language">) {
  const language = codeSnippetLanguageLabel(snippet.language).toLowerCase();
  if (!["text", "txt", "md", "markdown"].includes(language)) return false;
  const lines = snippet.code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return false;
  const separatorIndex = lines.findIndex((line) => {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "").trim();
    return (
      trimmed.includes("|") &&
      trimmed.split("|").every((cell) => {
        const value = cell.trim();
        return /:?-{3,}:?/.test(value) && /^[\s:-]+$/.test(value);
      })
    );
  });
  return (
    separatorIndex > 0 &&
    (lines[separatorIndex - 1]?.match(/\|/g)?.length ?? 0) >= 2 &&
    (lines[separatorIndex + 1]?.match(/\|/g)?.length ?? 0) >= 2
  );
}

export function isReusableCodeSnippet(snippet: Pick<CodeSnippetReferenceItem, "code" | "language">) {
  if (isMarkdownTableCodeSnippet(snippet)) return false;
  if (containsNestedFence(snippet.code)) return false;
  if (looksLikeAsciiDiagram(snippet.code)) return false;
  if (looksLikeFakeArtifactMetadata(snippet.code)) return false;

  const language = codeSnippetLanguageLabel(snippet.language).toLowerCase();
  if (isStrongCodeLanguage(language)) return snippet.code.trim().length > 0;
  if (isDataLanguage(language)) return looksLikeStructuredData(snippet.code);
  return containsCodeSignal(snippet.code) && !looksLikeExplanatoryTranscript(snippet.code);
}

export function codeSnippetSemanticTitle(snippet: Pick<CodeSnippetReferenceItem, "code" | "language">) {
  const lines = snippet.code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines
    .map((line) => line.match(/^#{1,6}\s+(?:\d+[.)]\s*)?(.+)$/)?.[1])
    .find(Boolean);
  if (heading) return compactTitle(cleanMarkdownDisplayText(heading));

  for (const line of lines) {
    for (const [pattern, label] of IDENTIFIER_PATTERNS) {
      const match = line.match(pattern);
      if (match) return compactTitle(label(match));
    }
  }

  return compactTitle(cleanMarkdownDisplayText(codeSnippetFirstMeaningfulLine(snippet.code)));
}

function isStrongCodeLanguage(language: string) {
  return [
    "bash",
    "c",
    "cpp",
    "c++",
    "csharp",
    "c#",
    "css",
    "go",
    "html",
    "java",
    "javascript",
    "js",
    "jsx",
    "kotlin",
    "php",
    "python",
    "py",
    "ruby",
    "rust",
    "rs",
    "sh",
    "shell",
    "sql",
    "swift",
    "tsx",
    "ts",
    "typescript",
    "xml",
  ].includes(language);
}

function isDataLanguage(language: string) {
  return ["json", "jsonc", "toml", "yaml", "yml"].includes(language);
}

function looksLikeStructuredData(code: string) {
  return code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => line.includes(":") || line.includes("="));
}

function containsNestedFence(code: string) {
  return code
    .split(/\r?\n/)
    .map((line) => line.trimStart())
    .some((line) => line.startsWith("```") || line.startsWith("~~~"));
}

function containsCodeSignal(code: string) {
  return code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some(
      (line) =>
        /^(fn|def|class|interface|type|enum|struct|impl|func|function|const|let|var|export|import)\b/.test(
          line
        ) ||
        /^(select|insert|update|delete)\b/i.test(line) ||
        line.startsWith("#!") ||
        line.includes("=>") ||
        line.includes("->") ||
        line.includes("();") ||
        line.includes(") {") ||
        line.includes(" = ") ||
        line.includes(":=")
    );
}

function looksLikeAsciiDiagram(code: string) {
  const lines = code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return false;
  const diagramLines = lines.filter((line) => {
    const boxChars = line.match(/[┌┐└┘─│├┤┬┴┼═║╔╗╚╝╠╣╦╩╬]/g)?.length ?? 0;
    const arrows = line.match(/->|=>|←|→|▼/g)?.length ?? 0;
    return boxChars >= 2 || arrows > 0 || /^[\s+|-]+$/.test(line);
  });
  return diagramLines.length * 2 >= lines.length;
}

function looksLikeFakeArtifactMetadata(code: string) {
  const lower = code.toLowerCase();
  const markers = [
    "hash:",
    "hash generation",
    "type classification",
    "storage reference",
    "storage reference assignment",
    "provenance:",
    "provenance chain",
    "provenance metadata",
    "[timestamp, user, tool]",
    "code-001",
    "artifact referans id",
    "artifact reference id",
    "unique code id",
    "metadata population",
    "artifact creation",
  ];
  const markerCount = markers.filter((marker) => lower.includes(marker)).length;
  const hasPlaceholderCodeId = /\bcode-\d{3,}\b/i.test(code);
  return markerCount >= 2 || (markerCount >= 1 && hasPlaceholderCodeId);
}

function looksLikeExplanatoryTranscript(code: string) {
  const lower = code.toLowerCase();
  return lower.includes("user:") && lower.includes("assistant:");
}

function compactTitle(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 72) return normalized || "Code block";
  return `${normalized.slice(0, 36).trimEnd()}...${normalized.slice(-24).trimStart()}`;
}
