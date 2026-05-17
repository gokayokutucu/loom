import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseAssistantMarkdown } from "../services/assistantMarkdown";

const codeKeywords = new Set([
  "as",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "class",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "extends",
  "false",
  "for",
  "from",
  "function",
  "if",
  "import",
  "interface",
  "let",
  "new",
  "null",
  "private",
  "public",
  "return",
  "string",
  "switch",
  "true",
  "type",
  "undefined",
  "void",
]);

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const elements: Array<string | JSX.Element> = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      elements.push(text.slice(cursor, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      elements.push(
        <strong key={`${keyPrefix}-strong-${match.index}`}>
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      elements.push(
        <code key={`${keyPrefix}-code-${match.index}`}>
          {token.slice(1, -1)}
        </code>
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) elements.push(text.slice(cursor));
  return elements.length > 0 ? elements : text;
}

function syntaxClassForToken(token: string) {
  if (/^\/\/.*/.test(token)) return "comment";
  if (/^(['"`]).*\1$/.test(token)) return "string";
  if (/^\d+(\.\d+)?$/.test(token)) return "number";
  if (/^[A-Z][A-Za-z0-9_]*$/.test(token)) return "type";
  if (codeKeywords.has(token)) return "keyword";
  if (/^[A-Za-z_$][\w$]*(?=\()/.test(token)) return "function";
  return undefined;
}

function renderCodeLine(line: string, lineIndex: number) {
  const tokenPattern =
    /(\/\/.*|(['"`])(?:\\.|(?!\2).)*\2|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*(?=\()|\b[A-Za-z_$][\w$]*\b)/g;
  const parts: JSX.Element[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > cursor) {
      parts.push(
        <span key={`${lineIndex}-plain-${cursor}`}>
          {line.slice(cursor, match.index)}
        </span>
      );
    }
    const token = match[0];
    const tokenClass = syntaxClassForToken(token);
    parts.push(
      <span
        className={tokenClass ? `syntax-token syntax-${tokenClass}` : undefined}
        key={`${lineIndex}-token-${match.index}`}
      >
        {token}
      </span>
    );
    cursor = match.index + token.length;
    if (token.startsWith("//")) break;
  }

  if (cursor < line.length) {
    parts.push(<span key={`${lineIndex}-tail`}>{line.slice(cursor)}</span>);
  }
  return parts.length > 0 ? parts : "\u00a0";
}

function SyntaxHighlightedCode({ code }: { code: string }) {
  return (
    <>
      {code.split("\n").map((line, index) => (
        <span className="assistant-code-line" key={`${index}-${line}`}>
          {renderCodeLine(line, index)}
        </span>
      ))}
    </>
  );
}

function CodeBlock({
  language,
  code,
  closed,
  onCopyCode,
}: {
  language: string;
  code: string;
  closed: boolean;
  onCopyCode?: (code: string) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const canCopy = Boolean(onCopyCode) && closed && code.trim().length > 0;

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  async function copyCode() {
    if (!canCopy || !onCopyCode) return;
    const success = await onCopyCode(code);
    if (!success) return;
    setCopied(true);
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 2000);
  }

  return (
    <figure className="assistant-code-block">
      <figcaption>
        <span>{language}</span>
        {onCopyCode && (
          <button
            type="button"
            className={copied ? "assistant-code-copy copied" : "assistant-code-copy"}
            disabled={!canCopy}
            onClick={copyCode}
            aria-label={copied ? "Copied" : `Copy ${language} code`}
            title={canCopy ? (copied ? "Copied" : "Copy") : "Copy unavailable until code block completes"}
          >
            <Copy size={13} />
            {copied && (
              <span className="assistant-code-copy-check" aria-hidden="true">
                <Check size={9} strokeWidth={3} />
              </span>
            )}
          </button>
        )}
      </figcaption>
      <pre>
        <code>
          <SyntaxHighlightedCode code={code} />
        </code>
      </pre>
    </figure>
  );
}

export function AssistantMarkdownContent({
  markdown,
  onCopyCode,
}: {
  markdown: string;
  onCopyCode?: (code: string) => Promise<boolean>;
}) {
  return (
    <>
      {parseAssistantMarkdown(markdown).map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            <p key={`paragraph-${index}`}>
              {renderInlineMarkdown(block.text, `paragraph-${index}`)}
            </p>
          );
        }
        if (block.kind === "heading") {
          const Heading = `h${block.level}` as keyof JSX.IntrinsicElements;
          return (
            <Heading className="assistant-markdown-heading" key={`heading-${index}`}>
              {renderInlineMarkdown(block.text, `heading-${index}`)}
            </Heading>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List className="assistant-markdown-list" key={`list-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item}`}>
                  {renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === "table") {
          return (
            <div className="assistant-markdown-table-wrap" key={`table-${index}`}>
              <table className="assistant-markdown-table">
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th
                        key={`${headerIndex}-${header}`}
                        style={
                          block.align[headerIndex]
                            ? { textAlign: block.align[headerIndex] }
                            : undefined
                        }
                      >
                        {renderInlineMarkdown(header, `table-${index}-header-${headerIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {block.headers.map((_, cellIndex) => (
                        <td
                          key={`${rowIndex}-${cellIndex}`}
                          style={
                            block.align[cellIndex]
                              ? { textAlign: block.align[cellIndex] }
                              : undefined
                          }
                        >
                          {renderInlineMarkdown(
                            row[cellIndex] ?? "",
                            `table-${index}-${rowIndex}-${cellIndex}`
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <CodeBlock
            key={`code-${index}`}
            language={block.language}
            code={block.code}
            closed={block.closed}
            onCopyCode={onCopyCode}
          />
        );
      })}
    </>
  );
}
