export interface TranscriptInsertionInput {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  transcript: string;
}

export interface TranscriptInsertionResult {
  text: string;
  insertedText: string;
  caretIndex: number;
  changed: boolean;
}

function clampIndex(value: number, max: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), max));
}

function isWhitespace(value: string | undefined) {
  return value === undefined || /\s/.test(value);
}

export function insertTranscriptAtCursorText({
  text,
  selectionStart,
  selectionEnd,
  transcript,
}: TranscriptInsertionInput): TranscriptInsertionResult {
  const normalizedTranscript = transcript.trim();
  const start = clampIndex(Math.min(selectionStart, selectionEnd), text.length);
  const end = clampIndex(Math.max(selectionStart, selectionEnd), text.length);

  if (!normalizedTranscript) {
    return {
      text,
      insertedText: "",
      caretIndex: end,
      changed: false,
    };
  }

  const before = text.slice(0, start);
  const after = text.slice(end);
  const leadingSpace = before.length > 0 && !isWhitespace(before[before.length - 1]) ? " " : "";
  const trailingSpace = after.length > 0 && !isWhitespace(after[0]) ? " " : "";
  const insertedText = `${leadingSpace}${normalizedTranscript}${trailingSpace}`;
  const nextText = `${before}${insertedText}${after}`;

  return {
    text: nextText,
    insertedText,
    caretIndex: before.length + insertedText.length,
    changed: true,
  };
}
