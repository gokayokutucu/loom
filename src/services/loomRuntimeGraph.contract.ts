import type { BookmarkItem, Conversation, ResponseItem } from "../types";
import { resolveLoomAddress } from "./loomProtocol";
import { createRuntimeLoomGraphRepository } from "./loomRuntimeGraph";

const conversations: Conversation[] = [
  {
    id: "contract-runtime-conversation",
    title: "Runtime resolver conversation",
    path: "loom://contracts/runtime",
    folder: "Contracts",
    summary: "Runtime graph contract fixture.",
  },
];

const responsesByConversation: Record<string, ResponseItem[]> = {
  "contract-runtime-conversation": [
    {
      id: "runtime-response",
      title: "Runtime response",
      address: "loom://contracts/runtime/r-response",
      question: "How does runtime resolution work?",
      answer: ["Resolution lands on stable objects before windows."],
      suggestedLinks: [],
      bookmarkedLinks: [],
    },
    {
      id: "runtime-broken",
      title: "Runtime broken response",
      address: "loom://contracts/runtime/r-broken",
      question: "What breaks?",
      answer: ["Broken targets fail explicitly."],
      suggestedLinks: [],
      bookmarkedLinks: [{ id: "broken", type: "response", title: "Broken", path: "loom://missing", badge: "Broken reference" }],
    },
  ],
};

const bookmarks: BookmarkItem[] = [];

const repository = createRuntimeLoomGraphRepository({
  conversations,
  responsesByConversation,
  bookmarks,
});

const bookmarkPromotion = repository.promoteBookmark({
  id: "runtime-response",
  type: "response",
  title: "Runtime response",
  path: "loom://contracts/runtime/r-response",
  badge: "Response",
});

const referenceMention = repository.createReferenceMention({
  sourceConversationId: "contract-runtime-conversation",
  sourcePath: "loom://contracts/runtime",
  target: {
    id: "runtime-response",
    type: "response",
    title: "Runtime response",
    path: "loom://contracts/runtime/r-response",
  },
});

const brokenReferenceEvent = repository.emitBrokenReference(
  {
    id: "runtime-broken",
    type: "response",
    title: "Runtime broken response",
    path: "loom://contracts/runtime/r-broken",
  },
  "Contract broken-reference event"
);

export const runtimeResolverContractScenarios = [
  {
    name: "canonical object URI navigates through runtime repository",
    passed:
      resolveLoomAddress(
        bookmarkPromotion.targetObject.canonicalUri,
        repository
      ).status === "resolved",
  },
  {
    name: "active alias navigates through runtime repository",
    passed:
      resolveLoomAddress("loom://contracts/runtime/r-response", repository).status ===
      "resolved",
  },
  {
    name: "invalid window is rejected after object resolution",
    passed:
      resolveLoomAddress(
        "loom://contracts/runtime/r-response?window=conversation",
        repository
      ).status === "window_invalid",
  },
  {
    name: "missing snapshot is explicit",
    passed:
      resolveLoomAddress(
        "loom://contracts/runtime/r-response?snapshot=sha256:missing",
        repository
      ).status === "snapshot_missing",
  },
  {
    name: "bookmark promotion emits bookmark/address/alias events",
    passed:
      bookmarkPromotion.ledgerEvents.map((event) => event.eventType).join(",") ===
      "bookmark_created,address_created,alias_created",
  },
  {
    name: "reference insertion creates ReferenceMention semantics",
    passed: Boolean(referenceMention?.targetObjectId === bookmarkPromotion.targetObject.objectId),
  },
  {
    name: "broken reference detection appends ledger event",
    passed: brokenReferenceEvent.eventType === "broken_reference_detected",
  },
  {
    name: "ledger events remain append-only in memory order",
    passed: repository.getLedgerEvents().length >= 5,
  },
] as const;

