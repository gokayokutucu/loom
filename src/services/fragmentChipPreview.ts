export const FRAGMENT_CHIP_PREVIEW_MAX_CHARS = 100;

/**
 * Returns a short display-only preview of fragment selected text for composer
 * reference chips. The full text is preserved in link metadata; only the
 * visible label is truncated to keep the chip compact.
 */
export function truncateFragmentChipPreview(fullText: string): string {
  if (fullText.length <= FRAGMENT_CHIP_PREVIEW_MAX_CHARS) return fullText;
  const truncated = fullText.slice(0, FRAGMENT_CHIP_PREVIEW_MAX_CHARS).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");
  const cutAt = lastSpace > FRAGMENT_CHIP_PREVIEW_MAX_CHARS * 0.6 ? lastSpace : truncated.length;
  return truncated.slice(0, cutAt) + "…";
}
