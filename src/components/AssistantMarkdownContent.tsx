import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { normalizeAssistantMarkdownSource, parseAssistantMarkdown } from "../services/assistantMarkdown";
import { isReusableCodeSnippet } from "../services/codeSnippetDisplay";
import {
  loomLinkFromMarkdownReference,
  referenceLabelForMode,
} from "../services/referenceDisplay";
import type { LoomLink, ResponseCodeBlock } from "../types";

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

interface InlineReferenceHandlers {
  onOpenReference?: (link: LoomLink) => string | null;
  onReferenceHint?: (link: LoomLink, target: HTMLElement) => void;
  onReferenceHintClose?: () => void;
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  referenceHandlers: InlineReferenceHandlers = {}
) {
  const elements: Array<string | JSX.Element> = [];
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\[([^\]]+)\]\((loom:\/\/[^)\s]+)\))/g;
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
    } else if (token.startsWith("`")) {
      elements.push(
        <code key={`${keyPrefix}-code-${match.index}`}>
          {token.slice(1, -1)}
        </code>
      );
    } else {
      const link = loomLinkFromMarkdownReference(match[2] ?? "", match[3] ?? "");
      if (link) {
        elements.push(
          <button
            className="sent-prompt-reference-token assistant-reference-token"
            key={`${keyPrefix}-reference-${match.index}`}
            type="button"
            onClick={() => referenceHandlers.onOpenReference?.(link)}
            onMouseEnter={(event) =>
              referenceHandlers.onReferenceHint?.(link, event.currentTarget)
            }
            onMouseLeave={referenceHandlers.onReferenceHintClose}
            onFocus={(event) =>
              referenceHandlers.onReferenceHint?.(link, event.currentTarget)
            }
            onBlur={referenceHandlers.onReferenceHintClose}
            title={link.title}
            data-loom-path={link.path}
            data-loom-id={link.id}
            data-loom-title={link.title}
            data-loom-type={link.type}
            data-loom-canonical-uri={link.canonicalUri}
          >
            <span>{referenceLabelForMode(link, "title")}</span>
          </button>
        );
      } else {
        elements.push(token);
      }
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
  codeBlock,
  onCopyCode,
  onAddCodeReference,
}: {
  language: string;
  code: string;
  closed: boolean;
  codeBlock?: ResponseCodeBlock;
  onCopyCode?: (code: string) => Promise<boolean>;
  onAddCodeReference?: (codeBlock: ResponseCodeBlock) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const [referenced, setReferenced] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  const referencedTimerRef = useRef<number | null>(null);
  const canCopy = Boolean(onCopyCode) && closed && code.trim().length > 0;
  const canAddReference =
    Boolean(onAddCodeReference) &&
    closed &&
    code.trim().length > 0 &&
    (Boolean(codeBlock?.codeBlockId) || isReusableCodeSnippet({ language, code }));

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      if (referencedTimerRef.current) window.clearTimeout(referencedTimerRef.current);
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

  async function addCodeReference() {
    if (!canAddReference || !onAddCodeReference) return;
    const success = await onAddCodeReference(
      codeBlock ?? {
        blockIndex: 0,
        language,
        code,
      }
    );
    if (!success) return;
    setReferenced(true);
    if (referencedTimerRef.current) window.clearTimeout(referencedTimerRef.current);
    referencedTimerRef.current = window.setTimeout(() => {
      setReferenced(false);
      referencedTimerRef.current = null;
    }, 2000);
  }

  return (
    <figure className="assistant-code-block">
      <figcaption>
        <span>{language}</span>
        <div className="assistant-code-actions">
          {onCopyCode && (
            <button
              type="button"
              className={copied ? "assistant-code-copy copied" : "assistant-code-copy"}
              disabled={!canCopy}
              onClick={copyCode}
              aria-label={copied ? "Copied" : `Copy ${language} code`}
              data-tooltip={
                canCopy ? (copied ? "Copied" : "Copy code") : "Copy unavailable"
              }
              title={
                canCopy ? (copied ? "Copied" : "Copy") : "Copy unavailable until code block completes"
              }
            >
              <Copy size={13} />
              {copied && (
                <span className="assistant-code-copy-check" aria-hidden="true">
                  <Check size={9} strokeWidth={3} />
                </span>
              )}
            </button>
          )}
          {onAddCodeReference && (
            <button
              type="button"
              className={
                referenced ? "assistant-code-reference referenced" : "assistant-code-reference"
              }
              disabled={!canAddReference}
              onClick={addCodeReference}
              aria-label={`Add ${language} code block as Reference`}
              data-tooltip={
                canAddReference
                  ? referenced
                    ? "Reference added"
                    : "Add Reference"
                  : "Reference unavailable"
              }
              title={
                canAddReference
                  ? referenced
                    ? "Reference added"
                    : "Add Reference"
                  : closed
                    ? "Reference unavailable for this code block"
                    : "Reference unavailable until code block completes"
              }
            >
              <Link2 size={13} />
              {referenced && (
                <span className="assistant-code-copy-check" aria-hidden="true">
                  <Check size={9} strokeWidth={3} />
                </span>
              )}
            </button>
          )}
        </div>
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
  codeBlocks,
  onCopyCode,
  onAddCodeReference,
  onOpenReference,
  onReferenceHint,
  onReferenceHintClose,
}: {
  markdown: string;
  codeBlocks?: ResponseCodeBlock[];
  onCopyCode?: (code: string) => Promise<boolean>;
  onAddCodeReference?: (codeBlock: ResponseCodeBlock) => Promise<boolean>;
  onOpenReference?: (link: LoomLink) => string | null;
  onReferenceHint?: (link: LoomLink, target: HTMLElement) => void;
  onReferenceHintClose?: () => void;
}) {
  const normalizedMarkdown = normalizeAssistantMarkdownSource(markdown);
  const blocks = parseAssistantMarkdown(normalizedMarkdown);
  let renderedCodeBlockIndex = -1;
  const referenceHandlers = {
    onOpenReference,
    onReferenceHint,
    onReferenceHintClose,
  };
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "paragraph") {
          return (
            <p key={`paragraph-${index}`}>
              {renderInlineMarkdown(block.text, `paragraph-${index}`, referenceHandlers)}
            </p>
          );
        }
        if (block.kind === "heading") {
          const Heading = `h${block.level}` as keyof JSX.IntrinsicElements;
          return (
            <Heading className="assistant-markdown-heading" key={`heading-${index}`}>
              {renderInlineMarkdown(block.text, `heading-${index}`, referenceHandlers)}
            </Heading>
          );
        }
        if (block.kind === "thematicBreak") {
          return <hr className="assistant-markdown-rule" key={`rule-${index}`} />;
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          const prevBlock = index > 0 ? blocks[index - 1] : null;
          const followsColon = prevBlock?.kind === "paragraph" && prevBlock.text.trim().endsWith(":");
          return (
            <List
              className={followsColon ? "assistant-markdown-list assistant-markdown-list--follows-colon" : "assistant-markdown-list"}
              key={`list-${index}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item}`}>
                  {renderInlineMarkdown(
                    item,
                    `list-${index}-${itemIndex}`,
                    referenceHandlers
                  )}
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
                        {renderInlineMarkdown(
                          header,
                          `table-${index}-header-${headerIndex}`,
                          referenceHandlers
                        )}
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
                            `table-${index}-${rowIndex}-${cellIndex}`,
                            referenceHandlers
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
        renderedCodeBlockIndex += 1;
        const persistedCodeBlock = codeBlocks?.find(
          (codeBlock) =>
            codeBlock.blockIndex === renderedCodeBlockIndex ||
            codeBlock.code.trimEnd() === block.code.trimEnd()
        );
        return (
          <CodeBlock
            key={`code-${index}`}
            language={block.language}
            code={block.code}
            closed={block.closed}
            codeBlock={
              persistedCodeBlock ?? {
                blockIndex: renderedCodeBlockIndex,
                language: block.language,
                code: block.code,
              }
            }
            onCopyCode={onCopyCode}
            onAddCodeReference={onAddCodeReference}
          />
        );
      })}
    </>
  );
}
