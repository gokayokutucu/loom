import type { LoomLink } from "../types";

export interface ReferenceSuggestionSearchItem extends LoomLink {
  group?: string;
  keywords?: string[];
  searchText?: string[];
  subtitle?: string;
}

export interface ReferenceSuggestionMatch {
  score: number;
  reason?: string;
}

const RESPONSE_CODE_QUERY_PATTERN = /\bR-[a-z0-9]{0,6}\b/i;

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function compact(values: Array<string | undefined>) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function tokenMatches(value: string, query: string) {
  const normalizedValue = normalizeSearchValue(value);
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => normalizedValue.includes(token));
}

function bestMatch(
  current: ReferenceSuggestionMatch,
  score: number,
  reason?: string
): ReferenceSuggestionMatch {
  return score > current.score ? { score, reason } : current;
}

export function readableReferenceCode(item: ReferenceSuggestionSearchItem) {
  return item.referenceCode ?? item.meta?.displayCode ?? item.meta?.code ?? "";
}

export function responseCodeQuery(rawQuery: string) {
  const match = RESPONSE_CODE_QUERY_PATTERN.exec(rawQuery.trim());
  return match?.[0] ?? "";
}

function uniqueQueries(values: string[]) {
  const seen = new Set<string>();
  return values
    .map(normalizeSearchValue)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function scoreReferenceSuggestion(
  item: ReferenceSuggestionSearchItem,
  rawQuery: string
): ReferenceSuggestionMatch {
  const query = normalizeSearchValue(rawQuery);
  if (!query) return { score: 0 };

  let match: ReferenceSuggestionMatch = { score: -1 };
  const title = item.title;
  const code = readableReferenceCode(item);
  const canonicalUri = item.canonicalUri ?? "";
  const path = item.path;
  const id = item.id;
  const keywords = compact(item.keywords ?? item.meta?.keywords ?? []);
  const summaryFields = compact([
    item.subtitle,
    item.meta?.summary,
    item.badge,
    item.group,
    ...(item.searchText ?? []),
  ]);

  const normalizedCode = normalizeSearchValue(code);
  const normalizedId = normalizeSearchValue(id);
  const normalizedTitle = normalizeSearchValue(title);
  const codeQueries = uniqueQueries([query, responseCodeQuery(rawQuery)]);

  if (normalizedCode) {
    codeQueries.forEach((codeQuery) => {
      const responseCodeBoost = item.type === "response" && codeQuery.startsWith("r-") ? 200 : 0;
      if (normalizedCode === codeQuery) {
        match = bestMatch(match, 1000 + responseCodeBoost, `code: ${code}`);
      } else if (normalizedCode.startsWith(codeQuery)) {
        match = bestMatch(match, 920 + responseCodeBoost, `code: ${code}`);
      } else if (normalizedCode.includes(codeQuery)) {
        match = bestMatch(match, 820 + responseCodeBoost, `code: ${code}`);
      }
    });
  }

  if (normalizedId) {
    if (normalizedId === query) match = bestMatch(match, 980, `id: ${id}`);
    else if (normalizedId.startsWith(query)) match = bestMatch(match, 900, `id: ${id}`);
    else if (normalizedId.includes(query)) match = bestMatch(match, 760, `id: ${id}`);
  }

  if (normalizedTitle) {
    if (normalizedTitle === query) match = bestMatch(match, 760, "title");
    else if (normalizedTitle.startsWith(query)) match = bestMatch(match, 720, "title");
    else if (tokenMatches(title, query)) match = bestMatch(match, 680, "title");
    else if (normalizedTitle.includes(query)) match = bestMatch(match, 620, "title");
  }

  keywords.forEach((keyword) => {
    const normalizedKeyword = normalizeSearchValue(keyword);
    if (!normalizedKeyword) return;
    if (normalizedKeyword === query) match = bestMatch(match, 560, `keyword: ${keyword}`);
    else if (normalizedKeyword.startsWith(query)) {
      match = bestMatch(match, 520, `keyword: ${keyword}`);
    } else if (normalizedKeyword.includes(query) || tokenMatches(keyword, query)) {
      match = bestMatch(match, 470, `keyword: ${keyword}`);
    }
  });

  compact([canonicalUri, path]).forEach((address) => {
    const normalizedAddress = normalizeSearchValue(address);
    if (normalizedAddress.includes(query)) {
      match = bestMatch(
        match,
        canonicalUri && address === canonicalUri ? 420 : 380,
        "address"
      );
    }
  });

  summaryFields.forEach((field) => {
    const normalizedField = normalizeSearchValue(field);
    if (normalizedField.includes(query) || tokenMatches(field, query)) {
      match = bestMatch(match, 320, "summary");
    }
  });

  if (match.score < 0) return { score: -1 };

  const usageBoost = Math.min(item.meta?.usageCount ?? 0, 20);
  return {
    score: match.score + usageBoost,
    reason: match.reason,
  };
}

export function filterAndRankReferenceSuggestions<T extends ReferenceSuggestionSearchItem>(
  items: T[],
  rawQuery: string
): Array<T & { suggestionMatchReason?: string }> {
  const query = normalizeSearchValue(rawQuery);
  if (!query) return items.map((item) => ({ ...item }));

  return items
    .map((item, index) => ({
      item,
      index,
      match: scoreReferenceSuggestion(item, query),
    }))
    .filter((entry) => entry.match.score >= 0)
    .sort((a, b) => {
      if (b.match.score !== a.match.score) return b.match.score - a.match.score;
      return a.index - b.index;
    })
    .map(({ item, match }) => ({
      ...item,
      suggestionMatchReason: match.reason,
    }));
}
