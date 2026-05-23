const TRAILING_TIMESTAMP_PATTERN = /-\d{10,}$/;
const WEFT_DISPLAY_WORD_LIMIT = 2;
const SHORT_DISPLAY_CODE_PATTERN = /^[LWR]-[A-Z0-9]{5,6}$/;

interface DisplayCodeInput {
  code?: string | null;
  displayCode?: string | null;
}

function compactWeftSuffix(segments: string[]) {
  const semanticSegments = segments[0] === "R" ? segments.slice(1) : segments;
  return semanticSegments.slice(0, WEFT_DISPLAY_WORD_LIMIT).join(" ");
}

export function formatDisplayCode(code: string | null | undefined): string {
  const trimmedCode = code?.trim() ?? "";
  if (!trimmedCode) return "";

  const codeWithoutTimestamp = trimmedCode.replace(TRAILING_TIMESTAMP_PATTERN, "");
  const segments = codeWithoutTimestamp.split("-").filter(Boolean);

  if (segments[0] === "W" && segments[1] === "WEFT") {
    const semanticSuffix = compactWeftSuffix(segments.slice(2));
    return semanticSuffix ? `W-WEFT · ${semanticSuffix}` : "W-WEFT";
  }

  return codeWithoutTimestamp;
}

export function formatBadgeCode(input: DisplayCodeInput): string {
  const displayCode = input.displayCode?.trim();
  if (displayCode && SHORT_DISPLAY_CODE_PATTERN.test(displayCode)) {
    return displayCode;
  }
  return formatDisplayCode(input.code);
}
