/**
 * Deterministic, zero-LLM guard for ambiguous or accidentally incomplete
 * user prompts.
 *
 * Two product rules enforced:
 *
 * A) Short implicit prompts require an explicit subject.
 *    "explain", "why?", "what does this mean?" etc. are intercepted when
 *    the composer has no selected-text chip, reference chip, or attachment.
 *
 * B) Likely accidental incomplete single-sentence prompts are intercepted.
 *    Very short fragments ("Wh", "expl") or prompts that end with a dangling
 *    function word ("Can you explain why the") suggest accidental early Enter.
 *
 * Guard never fires when chips are present — the user has a clear subject.
 * Guard never fires for multi-sentence / longer prompts.
 */

// ── types ─────────────────────────────────────────────────────────────────────

export type PromptGuardResult =
  | { action: "allow" }
  | { action: "clarify"; reason: "missing-subject"; message: string }
  | { action: "clarify"; reason: "incomplete"; message: string };

export interface PromptGuardInput {
  /** Cleaned prompt text (no inline HTML/token markup). */
  prompt: string;
  /** True when at least one reference/selection chip is attached. */
  hasAttachedReferences: boolean;
  /** True when at least one attachment chip is attached. */
  hasAttachments: boolean;
  /** True when the submit surface is already anchored to an explicit Response. */
  hasActiveResponseTarget?: boolean;
  /** True when the caller already parsed quoted text outside the prompt string. */
  hasQuotedText?: boolean;
}

// ── implicit verb vocabulary ───────────────────────────────────────────────────

/**
 * Single-token and short multi-token patterns that are meaningless without
 * a subject.  Only matched when the full normalized prompt is an exact member.
 */
const IMPLICIT_VERB_SET: ReadonlySet<string> = new Set([
  "explain",
  "why",
  "what does this mean",
  "give example",
  "give an example",
  "give eg",
  "give an eg",
  "expand",
  "clarify",
  "summarize this",
  "summarise this",
  "translate this",
  "eli5",
  "elaborate",
  "describe this",
  "define this",
  "summarize",
  "summarise",
  "translate",
  "continue this",
  "go on",
  "and",
  "so",
  "ok",
  "okay",
  "yes",
  "sure",
  "correct",
  "right",
  "hmm",
  "hm",
  // Turkish equivalents
  "açıkla",
  "neden",
  "niye",
  "ne demek",
  "ne anlama geliyor",
  "örnek ver",
  "genişlet",
  "netleştir",
  "özetle",
  "çevir",
  "devam et",
  "anlat",
  "anlat bakalım",
  "tamam",
  "evet",
  "haklısın",
  "doğru",
]);

// ── dangling function words ────────────────────────────────────────────────────

/**
 * Single words that, when a prompt ends with them, strongly suggest the
 * sentence is unfinished.
 */
const DANGLING_TERMINALS: ReadonlySet<string> = new Set([
  // articles / determiners
  "a", "an", "the", "this", "that", "these", "those", "some", "any",
  // prepositions
  "of", "to", "for", "with", "about", "from", "in", "on", "at", "by",
  "as", "into", "onto", "upon", "against", "between", "among", "through",
  "during", "before", "after", "under", "over", "above", "below", "around",
  // auxiliaries / copula
  "do", "does", "did", "can", "could", "would", "should", "will", "shall",
  "may", "might", "must", "is", "are", "was", "were", "has", "have", "had",
  "be", "been", "being",
  // pronouns (dangling when final)
  "you", "i", "we", "they", "he", "she", "it",
  // conjunctions
  "and", "or", "but", "nor", "yet", "because", "since", "although",
  "though", "while", "whereas", "if", "unless", "until",
  // question words standing alone at end
  "when", "where", "which", "who", "whom", "whose", "what", "how",
  // Turkish articles / particles
  "bir", "bu", "şu", "o",
  "ve", "veya", "ya", "ya da", "için", "ile", "ki",
  "mi", "mı", "mu", "mü",
  "da", "de",
]);

/**
 * Multi-word phrase suffixes that indicate an incomplete sentence.
 * Tested against the normalized (lowercased, no-trailing-punctuation) end of prompt.
 */
const DANGLING_MULTI_SUFFIXES: readonly string[] = [
  "do you", "can you", "could you", "would you", "should you",
  "do we", "can we", "could we",
  "do i", "can i", "could i",
  "why the", "why a", "why an",
  "how does", "how do", "how is", "how are",
  "which kind of", "which kind", "which type of", "which type",
  "want to", "need to", "going to",
  "that the", "that a", "that an",
  "because the", "because a",
  "if the", "if a", "if an",
  "when the", "when a",
];

const INCOMPLETE_EXACT_SET: ReadonlySet<string> = new Set([
  "w",
  "wh",
  "wha",
  "what",
  "h",
  "ho",
  "how",
  "how d",
  "expl",
  "summ",
  "trans",
  "can you explain",
  "could you explain",
  "would you explain",
  "can you summarize",
  "could you summarize",
  "would you summarize",
  "can you translate",
  "could you translate",
  "would you translate",
]);

// ── function-word set (used for subject detection) ────────────────────────────

const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "of", "to", "for", "with", "about", "from", "in",
  "on", "at", "by", "as", "and", "or", "but", "is", "are", "was", "were",
  "be", "been", "being", "do", "does", "did", "this", "that", "these",
  "those", "it", "its", "he", "she", "we", "you", "they", "i", "me",
  "my", "mine", "our", "ours", "your", "yours", "him", "his", "her",
  "hers", "them", "their", "theirs", "what", "how", "when", "where",
  "which", "who", "whom", "whose", "can", "could", "would", "should",
  "will", "shall", "may", "might", "must", "have", "has", "had",
  "explain", "expand", "clarify", "summarize", "summarise", "translate",
  "elaborate", "describe", "define", "continue",
  // Turkish
  "bir", "bu", "şu", "o", "ve", "veya", "ile", "için",
  "açıkla", "özetle", "çevir", "anlat",
]);

// ── implicit-verb prefix set (for subject-presence check) ─────────────────────

const IMPLICIT_VERB_PREFIXES: readonly string[] = [
  "explain", "why", "what does", "what is", "give", "expand", "clarify",
  "summarize", "summarise", "translate", "eli5", "elaborate", "describe",
  "define", "continue", "go on",
  // Turkish
  "açıkla", "neden", "niye", "özetle", "çevir", "anlat",
];

// ── helpers ───────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?!.…,;:]+$/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim();
}

function hasQuotedSubject(text: string): boolean {
  return /"[^"]{2,}"|'[^']{2,}'|“[^”]{2,}”|‘[^’]{2,}’/.test(text);
}

function isTurkish(text: string): boolean {
  return /[ğşçıöü]/i.test(text) ||
    /\b(nedir|nasıl|neden|niye|niçin|nereye|hangi|kim|ne|bu|bir|ve|veya|için|ile|ki|ama|fakat|lakin|ancak|veya|mi|mı|mu|mü|da|de)\b/i.test(text);
}

/**
 * Checks whether the prompt contains at least one content word (word ≥ 3 chars
 * that is not a function word and not an implicit verb prefix), indicating the
 * user provided an explicit subject.
 */
function hasExplicitSubject(normalized: string): boolean {
  // Remove leading implicit-verb prefix
  let rest = normalized;
  for (const prefix of IMPLICIT_VERB_PREFIXES) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length).trim();
      break;
    }
  }

  const words = rest.split(/\s+/).filter(Boolean);
  return words.some(
    (word) => word.length >= 3 && !FUNCTION_WORDS.has(word) && !/^\d+$/.test(word)
  );
}

/** True if the normalized prompt ends with a dangling terminal word or phrase. */
function endsWithDangling(normalized: string): boolean {
  // Single terminal word
  const lastWord = normalized.split(/\s+/).pop() ?? "";
  return DANGLING_TERMINALS.has(lastWord);
}

function endsWithDanglingPhrase(normalized: string): boolean {
  return DANGLING_MULTI_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * True if `text` (after stripping trailing punctuation) looks like a
 * recognized standalone short question:
 *  - a single word ≥ 2 chars with no function-word flag
 *  - e.g. "GPS?", "OAuth?", "Rust?"
 */
function isRecognizedShortQuery(normalized: string): boolean {
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length !== 1) return false;
  const word = words[0];
  // Must be ≥ 2 chars and not a pure function/implicit word
  return word.length >= 2 && !FUNCTION_WORDS.has(word) && !IMPLICIT_VERB_SET.has(word);
}

/** True if prompt is multiple lines or contains multiple sentences. */
function isMultiSentence(raw: string): boolean {
  // Multiple newlines → paragraphs
  if (/\n/.test(raw.trim())) return true;
  // Multiple sentences separated by . ! ?
  const sentences = raw
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
  return sentences.length > 1;
}

// ── message builders ──────────────────────────────────────────────────────────

function missingSubjectMessage(normalizedVerb: string, turkish: boolean): string {
  if (turkish) {
    const verbMap: Record<string, string> = {
      açıkla: "açıklamam",
      özetle: "özetlemem",
      çevir: "çevirmem",
      anlat: "anlatmam",
      neden: "neden öyle olduğunu belirtmem",
      niye: "neden öyle olduğunu belirtmem",
    };
    const verbTr = verbMap[normalizedVerb] ?? `"${normalizedVerb}"`;
    return `Neyi ${verbTr} istiyorsun? Bir seçim, referans veya konu ekleyebilirsin.`;
  }
  const verbMap: Record<string, string> = {
    explain: "explain",
    why: "answer",
    "what does this mean": "clarify",
    "give example": "provide an example of",
    "give an example": "provide an example of",
    expand: "expand on",
    clarify: "clarify",
    summarize: "summarize",
    summarise: "summarise",
    translate: "translate",
    eli5: "explain simply",
    elaborate: "elaborate on",
    "describe this": "describe",
    "define this": "define",
    "summarize this": "summarize",
    "summarise this": "summarise",
    "translate this": "translate",
  };
  const verb = verbMap[normalizedVerb] ?? `"${normalizedVerb}"`;
  return `What would you like me to ${verb}? Add a selection, reference, or subject to your message.`;
}

function incompleteMessage(rawFragment: string, turkish: boolean): string {
  const display = rawFragment.length > 60 ? `${rawFragment.slice(0, 60)}…` : rawFragment;
  if (turkish) {
    return `"${display}" ile ne sormak istedin?`;
  }
  return `You wrote "${display}" — what did you want to ask?`;
}

// ── main guard ────────────────────────────────────────────────────────────────

/**
 * Evaluates whether a prompt should be sent to the model or intercepted for
 * clarification.
 *
 * Returns `{ action: "allow" }` when the prompt appears well-formed.
 * Returns `{ action: "clarify", reason, message }` when the guard fires.
 *
 * The guard never fires when chips are present (the user has an explicit
 * subject even if the text is short).
 *
 * The guard never fires for multi-sentence / longer prompts.
 */
export function checkPromptGuard(input: PromptGuardInput): PromptGuardResult {
  const {
    prompt,
    hasAttachedReferences,
    hasAttachments,
    hasActiveResponseTarget = false,
    hasQuotedText = false,
  } = input;

  const trimmed = prompt.trim();
  if (trimmed.length === 0) return { action: "allow" };

  // A chip, quoted subject, or response anchor is an explicit subject.
  if (
    hasAttachedReferences ||
    hasAttachments ||
    hasActiveResponseTarget ||
    hasQuotedText ||
    hasQuotedSubject(trimmed)
  ) {
    return { action: "allow" };
  }

  // Multi-sentence or paragraph → allow.
  if (isMultiSentence(trimmed)) return { action: "allow" };

  const normalized = normalize(trimmed);
  const turkish = isTurkish(trimmed);

  // ── Rule A: exact implicit verb with no subject ──────────────────────────
  if (IMPLICIT_VERB_SET.has(normalized)) {
    return {
      action: "clarify",
      reason: "missing-subject",
      message: missingSubjectMessage(normalized, turkish),
    };
  }

  // ── Rule B: accidental incomplete prompt ─────────────────────────────────

  if (INCOMPLETE_EXACT_SET.has(normalized)) {
    return {
      action: "clarify",
      reason: "incomplete",
      message: incompleteMessage(trimmed, turkish),
    };
  }

  // Very short (< 5 chars) and not a recognized standalone short query.
  if (trimmed.length < 5 && !isRecognizedShortQuery(normalized)) {
    return {
      action: "clarify",
      reason: "incomplete",
      message: incompleteMessage(trimmed, turkish),
    };
  }

  // Phrase suffixes such as "do you" and "why the" are strong enough to
  // clarify even if the fragment contains a content word earlier.
  if (trimmed.length <= 120 && endsWithDanglingPhrase(normalized)) {
    return {
      action: "clarify",
      reason: "incomplete",
      message: incompleteMessage(trimmed, turkish),
    };
  }

  // Ends with dangling word/phrase + no explicit subject + single sentence.
  // Cap at 120 chars: longer prompts that end in "you" etc. are probably
  // intentional stream-of-consciousness questions.
  if (
    trimmed.length <= 120 &&
    endsWithDangling(normalized) &&
    !hasExplicitSubject(normalized)
  ) {
    return {
      action: "clarify",
      reason: "incomplete",
      message: incompleteMessage(trimmed, turkish),
    };
  }

  return { action: "allow" };
}
