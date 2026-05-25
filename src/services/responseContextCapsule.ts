/*
 * Legacy/dev/test-only runtime capsule helpers after the Rust-authoritative cutover.
 * Do not use this module as product runtime authority.
 * Product runtime must go through LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type { ResponseItem } from "../types";
import { cleanMarkdownDisplayText } from "./assistantMarkdown";

export interface AskContextCapsule {
  sourceLoomId: string;
  sourceResponseId?: string;
  sourceResponseCode?: string;
  sourceTitle?: string;
  sourceCanonicalUri?: string;
  summary: string;
  keyPoints: string[];
  keywords: string[];
  entities: string[];
  codeBlockSummaries?: Array<{
    language?: string;
    summary: string;
  }>;
  selectedText?: string;
  selectedTextHash?: string;
  sourceLength: number;
  capsuleSource: "heuristic" | "metadata" | "quickModel";
  updatedAt: number;
  responseId: string;
  loomId: string;
  responseCode?: string;
  title: string;
  canonicalUri?: string;
  codeBlocks?: Array<{
    language?: string;
    summary: string;
  }>;
  generatedBy: "heuristic" | "quickModel";
}

export type ResponseContextCapsule = AskContextCapsule;

export type FocusedAskIntent =
  | "acronym_expansion"
  | "definition"
  | "translation"
  | "explain_this"
  | "relation_to_reference"
  | "implementation_in_topic"
  | "how_it_works_with_reference"
  | "relation_to_source"
  | "how_it_works"
  | "usage"
  | "unknown";

export interface AskActiveReferenceContext {
  label: string;
  targetKind?: string;
  targetId?: string;
  targetUri?: string;
  selectedText?: string;
  preview?: string;
  sourceResponseId?: string;
}

export interface AskContextPayload {
  context: string[];
  backgroundContext: string[];
  usedFullResponse: boolean;
  contextCharCount: number;
  capsuleSource: AskContextCapsule["capsuleSource"];
  includedSelectedText: boolean;
  focusedIntent: FocusedAskIntent;
  sourceContextClues: string[];
}

interface CodeBlockSummary {
  language?: string;
  summary: string;
  code?: string;
}

function responseText(response: ResponseItem) {
  return response.answer.join("\n\n").trim();
}

function compactText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function textHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function firstSentence(text: string) {
  const normalized = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  const sentence = normalized.match(/^.{1,360}?(?:[.!?](?:\s|$)|$)/)?.[0] ?? normalized;
  return compactText(sentence || normalized, 360);
}

function extractKeyPoints(text: string) {
  const points = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+|\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+|\d+\.\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => compactText(line, 180));
  if (points.length > 0) return points;
  return text
    .split(/\n{2,}/)
    .map((line) => compactText(line, 180))
    .filter(Boolean)
    .slice(0, 4);
}

function extractEntities(text: string) {
  const matches = text.match(/\b[A-Z][A-Za-z0-9_:.#/-]{2,}\b/g) ?? [];
  return Array.from(new Set(matches)).slice(0, 12);
}

function extractKeywords(text: string) {
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "because",
    "before",
    "between",
    "should",
    "their",
    "there",
    "these",
    "those",
    "through",
    "which",
    "while",
    "with",
    "without",
  ]);
  const counts = new Map<string, number>();
  const matches = text.toLowerCase().match(/\b[a-z0-9][a-z0-9_-]{4,}\b/g) ?? [];
  matches.forEach((word) => {
    if (stopWords.has(word)) return;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word)
    .slice(0, 10);
}

function extractCodeBlocks(text: string): CodeBlockSummary[] {
  const blocks: CodeBlockSummary[] = [];
  const pattern = /```([A-Za-z0-9_+.-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null && blocks.length < 4) {
    const language = match[1] || "text";
    const code = match[2].trim();
    const firstLine = code.split("\n").find((line) => line.trim())?.trim() ?? "";
    blocks.push({
      language,
      summary: compactText(firstLine ? `${language}: ${firstLine}` : `${language} code block`, 180),
      code: code.length <= 1200 ? code : undefined,
    });
  }
  return blocks;
}

export function createHeuristicResponseContextCapsule(
  response: ResponseItem,
  loomId: string,
  selectedText?: string
): ResponseContextCapsule {
  const text = responseText(response);
  const keywords = response.meta?.keywords?.length ? response.meta.keywords : extractKeywords(text);
  const codeBlocks = extractCodeBlocks(text).map(({ language, summary }) => ({
    language,
    summary,
  }));
  const selected = selectedText ? compactText(selectedText, 1600) : undefined;
  return {
    sourceLoomId: loomId,
    sourceResponseId: response.id,
    sourceResponseCode: response.meta?.code,
    sourceTitle: response.meta?.title || cleanMarkdownDisplayText(response.title) || response.title,
    sourceCanonicalUri: response.meta?.canonicalUri,
    responseId: response.id,
    loomId,
    responseCode: response.meta?.code,
    title: response.meta?.title || cleanMarkdownDisplayText(response.title) || response.title,
    canonicalUri: response.meta?.canonicalUri,
    summary: response.meta?.summary || firstSentence(text),
    keyPoints: extractKeyPoints(text),
    keywords,
    entities: extractEntities(text),
    codeBlockSummaries: codeBlocks,
    codeBlocks,
    selectedText: selected,
    selectedTextHash: selected ? textHash(selected) : undefined,
    sourceLength: text.length,
    capsuleSource: response.meta?.summary ? "metadata" : "heuristic",
    generatedBy: "heuristic",
    updatedAt: Date.now(),
  };
}

function questionNeedsExactText(question: string) {
  return /\b(quote|exact|copy|sentence|verbatim|aynen|alıntı|cümle|tam olarak)\b/i.test(question);
}

function questionNeedsCode(question: string) {
  return /\b(code|function|class|bug|error|snippet|kod|fonksiyon|sınıf|hata)\b/i.test(question);
}

function sentenceContextForFragment(text: string, fragment: string) {
  const normalizedFragment = fragment.trim();
  if (!normalizedFragment) return [];
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((sentence) => compactText(sentence, 260))
    .filter((sentence) =>
      sentence.toLocaleLowerCase("tr-TR").includes(normalizedFragment.toLocaleLowerCase("tr-TR"))
    )
    .slice(0, 2);
}

function buildSourceContextClues(input: {
  fullText: string;
  selectedText?: string;
  capsule: ResponseContextCapsule;
}) {
  const clues: string[] = [];
  if (input.capsule.sourceTitle ?? input.capsule.title) {
    clues.push(`Source title: ${input.capsule.sourceTitle ?? input.capsule.title}`);
  }
  if (input.selectedText) {
    sentenceContextForFragment(input.fullText, input.selectedText).forEach((sentence) => {
      clues.push(`Nearby source text: ${sentence}`);
    });
  }
  if (input.capsule.keywords.length > 0) {
    clues.push(`Keywords: ${input.capsule.keywords.slice(0, 8).join(", ")}`);
  }
  if (input.capsule.entities?.length) {
    clues.push(`Entities: ${input.capsule.entities.slice(0, 8).join(", ")}`);
  }
  return clues.slice(0, 6);
}

function isAcronymLike(value: string) {
  const normalized = value.trim();
  return /^[A-Z][A-Z0-9.+#-]{1,9}$/.test(normalized);
}

export function resolveFocusedAskIntent(input: {
  selectedText?: string;
  activeReferences?: AskActiveReferenceContext[];
  currentQuestion: string;
}): FocusedAskIntent {
  const selectedText = input.selectedText?.trim() ?? "";
  const question = input.currentQuestion.toLocaleLowerCase("tr-TR");
  const hasActiveReference = Boolean(input.activeReferences?.some((reference) => reference.label.trim()));
  const mentionsImplementation =
    question.includes("nasıl yapılır") ||
    question.includes("nasil yapilir") ||
    question.includes("nasıl uygulanır") ||
    question.includes("nasil uygulanir") ||
    question.includes("nasıl olur") ||
    question.includes("nasil olur") ||
    question.includes("nerede kullanılır") ||
    /\b(how is this done|how would you implement|how does .* work|where is it used)\b/i.test(
      input.currentQuestion
    );
  const mentionsRelation =
    question.includes("ilişkisi") ||
    question.includes("ilişkili") ||
    question.includes("bağlantısı") ||
    question.includes("bağlarız") ||
    /\b(relation|relationship|relate|related|connect|with)\b/i.test(input.currentQuestion);
  const mentionsTopic =
    question.includes("event sourcing") ||
    question.includes("cqrs") ||
    question.includes("plugin") ||
    question.includes("source") ||
    question.includes("tarafında") ||
    question.includes("içinde") ||
    /\b(with|in|inside|using)\b/i.test(input.currentQuestion);
  const asksExpansion =
    question.includes("açılım") ||
    question.includes("acilim") ||
    question.includes("ne anlama geliyor") ||
    question.includes("ne demek") ||
    /\b(what does it stand for|stands for|meaning|expansion)\b/i.test(input.currentQuestion);
  const asksUsage =
    question.includes("hangi işlerde") ||
    question.includes("hangi islerde") ||
    question.includes("nerede kullanılır") ||
    question.includes("nerelerde kullanılır") ||
    question.includes("ne için kullanılır") ||
    question.includes("ne icin kullanilir") ||
    question.includes("hangi durumlarda") ||
    /\b(where is it used|what is it used for|use cases)\b/i.test(input.currentQuestion);
  if (selectedText && isAcronymLike(selectedText) && asksExpansion) {
    return "acronym_expansion";
  }
  if (
    /\b(çevir|translate|translation|türkçesi|ingilizcesi|english)\b/i.test(
      input.currentQuestion
    )
  ) {
    return "translation";
  }
  if (
    question.includes("ilişkisi") ||
    question.includes("bağlantısı") ||
    /\b(relation|relationship|related)\b/i.test(input.currentQuestion)
  ) {
    if (hasActiveReference) return "relation_to_reference";
    return "relation_to_source";
  }
  if (hasActiveReference && mentionsImplementation && mentionsTopic) {
    return "implementation_in_topic";
  }
  if (hasActiveReference && mentionsImplementation) {
    return "how_it_works_with_reference";
  }
  if (hasActiveReference && mentionsRelation) {
    return "relation_to_reference";
  }
  if (hasActiveReference && asksUsage) {
    return "usage";
  }
  if (
    question.includes("nasıl") ||
    /\b(how|works|work|implemented|yapılıyor)\b/i.test(input.currentQuestion)
  ) {
    return "how_it_works";
  }
  if (
    question.includes("nedir") ||
    question.includes("ne anlama geliyor") ||
    question.includes("ne demek") ||
    question.includes("bu ne") ||
    /\b(what is|what does it mean|what is it|define|definition)\b/i.test(input.currentQuestion)
  ) {
    return "definition";
  }
  if (
    question.includes("açıkla") ||
    question.includes("anlat") ||
    /\b(explain|clarify)\b/i.test(input.currentQuestion)
  ) {
    return "explain_this";
  }
  return "unknown";
}

export function buildAskContextPayload(input: {
  response: ResponseItem;
  selectedText?: string;
  userQuestion: string;
  capsule: ResponseContextCapsule;
  activeReferences?: AskActiveReferenceContext[];
}): AskContextPayload {
  const fullText = responseText(input.response);
  const selectedText = input.selectedText?.trim();
  const codeBlocks = extractCodeBlocks(fullText);
  const hasSelectedText = Boolean(selectedText);
  const focusedIntent = resolveFocusedAskIntent({
    selectedText,
    activeReferences: input.activeReferences,
    currentQuestion: input.userQuestion,
  });
  const sourceContextClues = buildSourceContextClues({
    fullText,
    selectedText,
    capsule: input.capsule,
  });
  const codeSummaries = input.capsule.codeBlockSummaries ?? input.capsule.codeBlocks ?? [];
  const shouldUseFullResponse =
    !hasSelectedText &&
    (fullText.length <= 1200 ||
      questionNeedsExactText(input.userQuestion) ||
      (questionNeedsCode(input.userQuestion) && fullText.length <= 2200));
  const sourceMetadata = [
    `Title: ${input.capsule.sourceTitle ?? input.capsule.title}`,
    input.capsule.sourceResponseCode ?? input.capsule.responseCode
      ? `Response code: ${input.capsule.sourceResponseCode ?? input.capsule.responseCode}`
      : "",
    input.capsule.sourceCanonicalUri ?? input.capsule.canonicalUri
      ? `Canonical URI: ${input.capsule.sourceCanonicalUri ?? input.capsule.canonicalUri}`
      : "",
  ].filter(Boolean).join("\n");
  const sourceBackground = [
    `Summary: ${input.capsule.summary}`,
    input.capsule.keyPoints.length > 0
      ? `Key points:\n${input.capsule.keyPoints.map((point) => `- ${point}`).join("\n")}`
      : "",
    input.capsule.keywords.length > 0
      ? `Keywords: ${input.capsule.keywords.join(", ")}`
      : "",
    input.capsule.entities?.length
      ? `Entities: ${input.capsule.entities.join(", ")}`
      : "",
    codeSummaries.length
      ? `Code summaries:\n${codeSummaries
          .map((block) => `- ${block.language ?? "text"}: ${block.summary}`)
          .join("\n")}`
      : "",
  ].filter(Boolean).join("\n");
  const selectedFocus = selectedText
    ? [
        "Current task:",
        "Answer the user's question directly about the selected fragment.",
        `Selected fragment:\n"${compactText(selectedText, 1800)}"`,
        `User question:\n"${compactText(input.userQuestion, 700)}"`,
        `Detected intent:\n${focusedIntent}`,
        [
          "Answer requirements:",
          "- Answer directly.",
          "- Do not restate the question.",
          "- Do not ask a new question.",
          "- Do not explain the whole source response unless needed.",
          "- If the selected fragment is an acronym and the user asks for its expansion, give the expansion first.",
          focusedIntent === "translation"
            ? "- Translate only the selected fragment. Do not explain the whole source response."
            : "",
          focusedIntent === "translation"
            ? "- If the user asks for English, answer with the English translation first."
            : "",
          "- Keep the answer concise and conversational; 1-3 short paragraphs are okay when useful.",
          focusedIntent === "acronym_expansion"
            ? `- The answer should start with: "${selectedText} = <expansion>".`
            : "",
          focusedIntent === "acronym_expansion"
            ? "- Use source context clues to disambiguate before relying on generic acronym knowledge."
            : "",
          focusedIntent === "acronym_expansion"
            ? "- If the source context does not explicitly define the acronym, answer with cautious wording such as likely or commonly used. Do not choose an unrelated expansion that does not fit the source context."
            : "",
        ].filter(Boolean).join("\n"),
      ].join("\n\n")
    : "";
  const activeReferenceFocus = input.activeReferences?.length
    ? [
        "Active reference/context:",
        ...input.activeReferences.map((reference) => {
          const details = [
            `- ${compactText(reference.label, 180)}`,
            reference.selectedText ? `  selected text: ${compactText(reference.selectedText, 220)}` : "",
            reference.preview ? `  preview: ${compactText(reference.preview, 260)}` : "",
            reference.targetUri ? `  target URI: ${compactText(reference.targetUri, 220)}` : "",
          ].filter(Boolean);
          return details.join("\n");
        }),
        "Instruction: Treat active reference/context chips as first-class context, not decoration.",
        focusedIntent === "implementation_in_topic"
          ? "Current task: connect the active reference/context to the topic requested in the user question."
          : "",
        focusedIntent === "relation_to_reference"
          ? "Current task: explain the relationship between the active reference/context and the requested source/topic."
          : "",
        focusedIntent === "how_it_works_with_reference"
          ? "Current task: explain how the active reference/context works in the requested source/topic."
          : "",
        focusedIntent === "usage"
          ? "Current task: explain where the active reference/context is used in the requested source/topic."
          : "",
        "- Do not ignore the active reference/context.",
        "- Do not answer only with generic source-topic basics when an active reference/context is present.",
      ].filter(Boolean).join("\n")
    : "";
  const context = [
    selectedFocus,
    activeReferenceFocus,
    selectedText ? "" : `Source context:\n${[sourceMetadata, sourceBackground].filter(Boolean).join("\n")}`,
  ].filter(Boolean);
  const backgroundContext = [
    selectedText && sourceContextClues.length > 0
      ? [
          "Source context clues:",
          ...sourceContextClues.map((clue) => `- ${clue}`),
          "Instruction: Use source context clues to disambiguate the selected fragment. If the source context does not explicitly define it, answer cautiously and do not choose an unrelated expansion.",
        ].join("\n")
      : "",
    selectedText && sourceMetadata
      ? `Background source context, use only if needed:\n${sourceMetadata}`
      : "",
    selectedText && sourceBackground
      ? `Background source context, use only if needed:\n${sourceBackground}`
      : "",
    shouldUseFullResponse ? `Source text:\n${fullText}` : "",
    !shouldUseFullResponse && questionNeedsCode(input.userQuestion)
      ? codeBlocks
          .filter((block) => block.code)
          .map((block) => `Short code excerpt (${block.language ?? "text"}):\n${block.code}`)
          .join("\n\n")
      : "",
  ].filter(Boolean);
  const allContext = [...context, ...backgroundContext];

  return {
    context,
    backgroundContext,
    usedFullResponse: shouldUseFullResponse,
    contextCharCount: allContext.reduce((total, item) => total + item.length, 0),
    capsuleSource: input.capsule.capsuleSource ?? input.capsule.generatedBy,
    includedSelectedText: Boolean(selectedText),
    focusedIntent,
    sourceContextClues,
  };
}
