import type { LoomLink } from "../types";

export function toLoomMarkdown(link: Pick<LoomLink, "title" | "path">) {
  return `[${link.title}](${link.path})`;
}

export function isLoomAddress(value: string) {
  return value.startsWith("loom://");
}

export function normalizeLoomTitle(title: string) {
  return title.trim().replace(/\s+/g, " ");
}
