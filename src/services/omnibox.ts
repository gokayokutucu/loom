import type { AddressSuggestion, Conversation } from "../types";
import { isLoomAddress } from "./loomProtocol";

export function isAddressBarAddressLike(value: string) {
  return isLoomAddress(value.trim());
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function conversationSuggestion(conversation: Conversation): AddressSuggestion {
  const code = conversation.meta?.displayCode ?? conversation.meta?.code ?? "";
  const isWeft = conversation.path.includes("/wefts/") || code.startsWith("W-");
  return {
    id: conversation.id,
    type: isWeft ? "loom" : "conversation",
    title: conversation.title,
    subtitle: conversation.summary,
    path: conversation.path,
    canonicalUri: conversation.meta?.canonicalUri,
    meta: conversation.meta,
    badge: isWeft ? "Weft" : "Loom",
    iconLabel: isWeft ? "Weft" : "Loom",
    referenceCode: conversation.meta?.displayCode ?? conversation.meta?.code,
  };
}

export function buildAddressBarSuggestions(input: {
  query: string;
  conversations: Conversation[];
  fallbackSuggestions?: AddressSuggestion[];
  limit?: number;
}) {
  const query = normalizeSearchText(input.query);
  const limit = input.limit ?? 8;
  const sourceSuggestions = input.conversations.map(conversationSuggestion);
  const suggestions = [...sourceSuggestions, ...(input.fallbackSuggestions ?? [])];

  if (!query) return suggestions.slice(0, limit);

  return suggestions
    .map((suggestion) => {
      const searchable = [
        suggestion.title,
        suggestion.subtitle,
        suggestion.path,
        suggestion.canonicalUri,
        suggestion.meta?.displayCode,
        suggestion.meta?.code,
        suggestion.badge,
      ]
        .filter(Boolean)
        .map((value) => normalizeSearchText(String(value)));
      const exactTitle = searchable[0] === query ? 0 : 1;
      const startsWithTitle = searchable[0]?.startsWith(query) ? 0 : 1;
      const matched = searchable.some((value) => value.includes(query));
      return { suggestion, matched, rank: exactTitle + startsWithTitle };
    })
    .filter((entry) => entry.matched)
    .sort((a, b) => a.rank - b.rank || a.suggestion.title.localeCompare(b.suggestion.title))
    .map((entry) => entry.suggestion)
    .slice(0, limit);
}

export type AddressBarEnterAction =
  | { kind: "suggestion"; suggestion: AddressSuggestion }
  | { kind: "address"; address: string }
  | { kind: "prompt"; prompt: string }
  | { kind: "none" };

export function resolveAddressBarEnterAction(input: {
  query: string;
  suggestions: AddressSuggestion[];
  selectedSuggestion: number;
}): AddressBarEnterAction {
  const selected =
    input.selectedSuggestion >= 0
      ? input.suggestions[input.selectedSuggestion]
      : undefined;
  if (selected) return { kind: "suggestion", suggestion: selected };

  const query = input.query.trim();
  if (!query) return { kind: "none" };
  if (isAddressBarAddressLike(query)) return { kind: "address", address: query };
  return { kind: "prompt", prompt: query };
}
