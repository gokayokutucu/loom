function protectTechnicalTitle(value: string) {
  return (
    /https?:\/\//i.test(value) ||
    /loom:\/\//i.test(value) ||
    /[`{}<>]/.test(value) ||
    /\b[A-Za-z0-9_-]+\.(?:txt|md|json|xml|csv|pdf|docx?|xlsx?|tsx?|jsx?|rs|py|sh|png|jpe?g|webp)\b/i.test(value)
  );
}

function matchCase(replacement: string, source: string) {
  if (!source) return replacement;
  if (source === source.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
  if (source[0] === source[0]?.toLocaleUpperCase()) {
    return `${replacement[0]?.toLocaleUpperCase() ?? ""}${replacement.slice(1)}`;
  }
  return replacement;
}

export function polishDisplayTitle(value?: string) {
  const normalized = (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (protectTechnicalTitle(normalized)) return normalized;

  const spacingPolished = normalized
    .replace(/([!?])\1+/g, "$1")
    .replace(/,{2,}/g, ",")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:!?])(?=\S)/g, "$1 ");

  return spacingPolished
    .replace(/\b(ned)\s*,\s*r\b/gi, (match) => matchCase("nedir", match))
    .replace(/\s+/g, " ")
    .trim();
}
