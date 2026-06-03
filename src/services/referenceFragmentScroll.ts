import type { LoomLink, LoomNavigationDestination } from "../types";

export interface FragmentTextMatch {
  start: number;
  end: number;
}

export function referenceNavigationOverridesForLink(
  link: Pick<LoomLink, "selectedText" | "fragmentHash" | "targetKind">,
  responseId: string
): Pick<
  LoomNavigationDestination,
  | "scrollTargetResponseId"
  | "scrollMode"
  | "fragmentText"
  | "fragmentHash"
  | "fragmentIncludeCode"
> {
  const fragmentText = link.selectedText?.trim();
  return {
    scrollTargetResponseId: responseId,
    scrollMode: fragmentText ? "fragment" : "exact",
    fragmentText: fragmentText || undefined,
    fragmentHash: link.fragmentHash,
    fragmentIncludeCode: link.targetKind === "code_block" ? true : undefined,
  };
}

export function firstRenderedFragmentTextMatch(
  renderedText: string,
  selectedText?: string
): FragmentTextMatch | null {
  const query = selectedText?.trim();
  if (!query) return null;
  const start = renderedText.indexOf(query);
  if (start < 0) return null;
  return { start, end: start + query.length };
}
