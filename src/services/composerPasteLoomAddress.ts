import type { LoomLink } from "../types";
import { loomLinkFromMarkdownReference } from "./referenceDisplay";

/**
 * Produce a compact, human-readable label for a raw `loom://` address so
 * that unresolved paste chips never display the full address string.
 *
 * Priority:
 * 1. Extract the first short code segment matching `[A-Z]-[A-Z0-9]+`
 *    (e.g. `L-9TXNW`, `R-ABCDE`).
 * 2. If no code found, truncate to 40 characters with an ellipsis.
 * 3. Final fallback: `"Loom reference"`.
 *
 * @example
 * compactLoomAddressLabel("loom://why-is-sleep-deprivation-so-dangerous/L-9TXNW?id=abc")
 * // → "L-9TXNW"
 *
 * compactLoomAddressLabel("loom://some-loom/L-ABCDE/r/R-12345?id=uuid")
 * // → "L-ABCDE"
 *
 * compactLoomAddressLabel("loom://wefts/weft-response-workflow-1780312055025-assistant")
 * // → "loom://wefts/weft-response-work…"
 */
export function compactLoomAddressLabel(address: string): string {
  const codeMatch = /\/([A-Z]-[A-Z0-9]{3,})/i.exec(address);
  if (codeMatch?.[1]) return codeMatch[1].toUpperCase();
  const MAX = 40;
  if (address.length > MAX) return `${address.slice(0, MAX)}…`;
  if (address.length > 0) return address;
  return "Loom reference";
}

/**
 * A segment from a paste operation: either plain text or a Loom-address
 * reference chip to be inserted into the composer.
 *
 * The shape intentionally mirrors ClipboardReferenceSegment in App.tsx so
 * segments produced here can be passed directly to insertClipboardSegments
 * without an adapter.
 */
export type LoomPasteSegment =
  | { kind: "text"; text: string }
  | { kind: "reference"; link: LoomLink };

/**
 * Regex that matches a raw loom:// address embedded in plain text.
 *
 * Captures: loom:// followed by non-whitespace characters that are valid in
 * a URL (excluding HTML-angle brackets, double-quotes, and a few other chars
 * that cannot appear in a bare address but are common surrounding prose chars).
 *
 * Trailing prose punctuation is stripped by sanitizeLoomAddress before the
 * candidate is forwarded to the link builder.
 */
const LOOM_ADDRESS_REGEX = /loom:\/\/[^\s<>"{}|\\^`[\]]+/g;

/**
 * Strip punctuation characters that commonly appear immediately after a URL
 * in prose text (sentence-ending periods, commas, semicolons, colons,
 * exclamation marks, closing parentheses/angle brackets) but are not part
 * of the Loom address itself.
 *
 * Query strings (?param=value) and hash fragments (#anchor) are intentionally
 * preserved — they carry response-identity information.
 */
function sanitizeLoomAddress(raw: string): string {
  return raw.replace(/[.,;:!)>]+$/, "");
}

function appendText(segments: LoomPasteSegment[], text: string) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last?.kind === "text") {
    last.text += text;
  } else {
    segments.push({ kind: "text", text });
  }
}

/**
 * Parse a plain-text string and return an ordered array of text and Loom
 * address reference segments.
 *
 * Returns an empty array when:
 * - `text` contains no `loom://` substring (fast path)
 * - every `loom://` candidate fails sanitisation or link building
 *
 * Callers should fall back to plain-text paste when the returned array is
 * empty or contains no `"reference"` segments.
 *
 * @example
 * extractLoomAddressSegments("Please compare loom://my-loom/L-ABC with today's answer")
 * // → [
 * //     { kind: "text",      text: "Please compare " },
 * //     { kind: "reference", link: { type: "conversation", path: "loom://my-loom/L-ABC", ... } },
 * //     { kind: "text",      text: " with today's answer" },
 * //   ]
 */
export function extractLoomAddressSegments(text: string): LoomPasteSegment[] {
  if (!text || !text.includes("loom://")) return [];

  const segments: LoomPasteSegment[] = [];
  let cursor = 0;
  const regex = new RegExp(LOOM_ADDRESS_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawCapture = match[0];
    const address = sanitizeLoomAddress(rawCapture);

    if (!address.startsWith("loom://")) continue;

    // Text before this match
    if (match.index > cursor) {
      appendText(segments, text.slice(cursor, match.index));
    }

    const link = loomLinkFromMarkdownReference(address, address);
    if (link) {
      segments.push({ kind: "reference", link });
    } else {
      // Unreachable in practice: loomLinkFromMarkdownReference returns null
      // only when the address doesn't start with "loom://", which is guarded
      // above. Fall back to text so no content is silently dropped.
      appendText(segments, address);
    }

    // Advance past the full capture (rawCapture may be longer than the
    // sanitized address — the stripped suffix reappears as a text segment).
    cursor = match.index + rawCapture.length;
    const strippedSuffix = rawCapture.slice(address.length);
    appendText(segments, strippedSuffix);
  }

  // Trailing text after the last match
  if (cursor < text.length) {
    appendText(segments, text.slice(cursor));
  }

  return segments;
}
