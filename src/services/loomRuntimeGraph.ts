import type {
  BookmarkItem,
  Conversation,
  LoomAliasRecord,
  LoomBookmarkPromotionResult,
  LoomGraphEdge,
  LoomGraphMutationRepository,
  LoomLedgerEvent,
  LoomLink,
  LoomObjectKind,
  LoomObjectType,
  LoomReferenceMentionRecord,
  LoomResolvedObject,
  LoomWindowProjection,
  LoomWindowType,
  ResponseItem,
} from "../types";
import { canonicalLoomUri, resolveLoomAddress } from "./loomProtocol";

const RUNTIME_STATE_KEY = "loom.runtime.graph.v1";
export const RUNTIME_BOOKMARKS_KEY = "loom.runtime.bookmarks.v1";

interface RuntimeGraphState {
  objects: LoomResolvedObject[];
  aliases: Array<{
    aliasUri: string;
    targetObjectId: string;
    isActive: boolean;
    replacementAliasUri?: string;
  }>;
  edges: LoomGraphEdge[];
  ledgerEvents: LoomLedgerEvent[];
  referenceMentions: LoomReferenceMentionRecord[];
  revisions: Array<{ objectId: string; revision: number; snapshot?: string }>;
}

const EMPTY_RUNTIME_STATE: RuntimeGraphState = {
  objects: [],
  aliases: [],
  edges: [],
  ledgerEvents: [],
  referenceMentions: [],
  revisions: [],
};

function readRuntimeState(): RuntimeGraphState {
  try {
    const value = window.localStorage.getItem(RUNTIME_STATE_KEY);
    return value ? { ...EMPTY_RUNTIME_STATE, ...JSON.parse(value) } : EMPTY_RUNTIME_STATE;
  } catch {
    return EMPTY_RUNTIME_STATE;
  }
}

function writeRuntimeState(state: RuntimeGraphState) {
  try {
    window.localStorage.setItem(RUNTIME_STATE_KEY, JSON.stringify(state));
  } catch {
    // Runtime graph persistence is an enhancement in the browser prototype.
  }
}

export function readRuntimeBookmarks(fallback: BookmarkItem[]) {
  try {
    const value = window.localStorage.getItem(RUNTIME_BOOKMARKS_KEY);
    return value ? (JSON.parse(value) as BookmarkItem[]) : fallback;
  } catch {
    return fallback;
  }
}

export function writeRuntimeBookmarks(bookmarks: BookmarkItem[]) {
  try {
    window.localStorage.setItem(RUNTIME_BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch {
    // Bookmark persistence is best effort in the browser prototype.
  }
}

function objectPrefix(kind: LoomObjectKind) {
  const prefix: Record<LoomObjectKind, string> = {
    conversation: "CNV",
    response: "RSP",
    quick_question: "QQ",
    bookmark: "BMK",
    fragment: "FRG",
    reference_mention: "RMN",
  };
  return prefix[kind];
}

function objectIdFor(kind: LoomObjectKind, id: string) {
  return `${objectPrefix(kind)}_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function objectKindForUiType(type: LoomObjectType): LoomObjectKind {
  if (type === "conversation") return "conversation";
  if (type === "bookmark") return "bookmark";
  return "response";
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "loom-object";
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolverAliasUris(aliasUri: string) {
  const aliases = new Set([aliasUri]);
  try {
    const url = new URL(aliasUri);
    if (url.protocol === "loom:") {
      aliases.add(`${url.protocol}//${url.host}${url.pathname}`);
    }
  } catch {
    aliases.add(aliasUri.split(/[?#]/)[0] ?? aliasUri);
  }
  return Array.from(aliases).filter(Boolean);
}

function makeObject({
  kind,
  id,
  title,
  aliasUri,
  status = "active",
  targetObjectId,
}: {
  kind: LoomObjectKind;
  id: string;
  title: string;
  aliasUri?: string;
  status?: LoomResolvedObject["status"];
  targetObjectId?: string;
}): LoomResolvedObject {
  const objectId = objectIdFor(kind, id);
  return {
    objectId,
    kind,
    status,
    title,
    canonicalUri: canonicalLoomUri(kind, objectId),
    aliasUri,
    targetObjectId,
  };
}

function baseGraphFromApp({
  conversations,
  responsesByConversation,
  bookmarks,
}: {
  conversations: Conversation[];
  responsesByConversation: Record<string, ResponseItem[]>;
  bookmarks: BookmarkItem[];
}) {
  const objects: LoomResolvedObject[] = [];
  const aliases: RuntimeGraphState["aliases"] = [];
  const edges: LoomGraphEdge[] = [];
  const conversationObjectIds = new Map<string, string>();

  function addAliasRecord(
    aliasUri: string | undefined,
    targetObjectId: string,
    isActive = true,
    replacementAliasUri?: string
  ) {
    if (!aliasUri) return;
    resolverAliasUris(aliasUri).forEach((lookupUri) => {
      if (
        aliases.some(
          (alias) =>
            alias.aliasUri === lookupUri &&
            alias.targetObjectId === targetObjectId &&
            alias.isActive === isActive &&
            alias.replacementAliasUri === replacementAliasUri
        )
      ) {
        return;
      }
      aliases.push({
        aliasUri: lookupUri,
        targetObjectId,
        isActive,
        replacementAliasUri,
      });
    });
  }

  function addObject(object: LoomResolvedObject) {
    objects.push(object);
    addAliasRecord(object.aliasUri, object.objectId);
  }

  function addEdge(fromObjectId: string, toObjectId: string, edgeType: LoomGraphEdge["edgeType"]) {
    edges.push({
      edgeId: `edge-base-${edges.length + 1}`,
      fromObjectId,
      toObjectId,
      edgeType,
    });
  }

  conversations.forEach((conversation) => {
    const object = makeObject({
      kind: "conversation",
      id: conversation.id,
      title: conversation.title,
      aliasUri: conversation.path,
    });
    addObject(object);
    addAliasRecord(conversation.meta?.canonicalUri, object.objectId);
    conversationObjectIds.set(conversation.id, object.objectId);
  });

  Object.entries(responsesByConversation).forEach(([conversationId, responses]) => {
    responses.forEach((response) => {
      const object = makeObject({
        kind: "response",
        id: `${conversationId}_${response.id}`,
        title: response.title,
        aliasUri: response.address,
        status: response.bookmarkedLinks.some((link) => link.badge === "Broken reference")
          ? "unreachable"
          : "active",
      });
      addObject(object);
      addAliasRecord(response.meta?.canonicalUri, object.objectId);
      const conversationObjectId = conversationObjectIds.get(conversationId);
      if (conversationObjectId) addEdge(conversationObjectId, object.objectId, "contains");
    });
  });

  bookmarks.forEach((bookmark) => {
    const target = aliases.find((alias) => alias.aliasUri === bookmark.path);
    const targetObject = target
      ? objects.find((object) => object.objectId === target.targetObjectId)
      : undefined;
    const bookmarkObject = makeObject({
      kind: "bookmark",
      id: bookmark.id,
      title: bookmark.editableTitle,
      aliasUri: bookmark.path,
      status: bookmark.badge === "Broken reference" ? "unreachable" : "active",
      targetObjectId: bookmark.targetObjectId ?? targetObject?.objectId,
    });
    addObject(bookmarkObject);
  });

  return { objects, aliases, edges };
}

export function createRuntimeLoomGraphRepository({
  conversations,
  responsesByConversation,
  bookmarks,
}: {
  conversations: Conversation[];
  responsesByConversation: Record<string, ResponseItem[]>;
  bookmarks: BookmarkItem[];
}): LoomGraphMutationRepository {
  const base = baseGraphFromApp({ conversations, responsesByConversation, bookmarks });
  let runtime = readRuntimeState();
  const objects = new Map<string, LoomResolvedObject>();
  const aliases = new Map<string, LoomAliasRecord>();
  let edges: LoomGraphEdge[] = [...base.edges, ...runtime.edges];

  function putObject(object: LoomResolvedObject) {
    objects.set(object.objectId, object);
    if (object.aliasUri) {
      aliases.set(object.aliasUri, {
        aliasUri: object.aliasUri,
        targetObject: object,
        isActive: true,
      });
    }
  }

  function persistRuntime(next: RuntimeGraphState) {
    runtime = next;
    writeRuntimeState(runtime);
  }

  function appendRuntimeObjects(nextObjects: LoomResolvedObject[]) {
    nextObjects.forEach(putObject);
    persistRuntime({
      ...runtime,
      objects: [...runtime.objects, ...nextObjects],
    });
  }

  function appendRuntimeAliases(
    nextAliases: RuntimeGraphState["aliases"],
    objectLookup: Map<string, LoomResolvedObject> = objects
  ) {
    nextAliases.forEach((alias) => {
      const targetObject = objectLookup.get(alias.targetObjectId);
      if (!targetObject) return;
      aliases.set(alias.aliasUri, {
        aliasUri: alias.aliasUri,
        targetObject,
        isActive: alias.isActive,
        replacementAliasUri: alias.replacementAliasUri,
      });
    });
    persistRuntime({
      ...runtime,
      aliases: [...runtime.aliases, ...nextAliases],
    });
  }

  function appendRuntimeEdges(nextEdges: LoomGraphEdge[]) {
    edges = [...edges, ...nextEdges];
    persistRuntime({
      ...runtime,
      edges: [...runtime.edges, ...nextEdges],
    });
  }

  function appendLedgerEvents(events: LoomLedgerEvent[]) {
    persistRuntime({
      ...runtime,
      ledgerEvents: [...runtime.ledgerEvents, ...events],
    });
    return events;
  }

  [...base.objects, ...runtime.objects].forEach(putObject);
  [...base.aliases, ...runtime.aliases].forEach((alias) => {
    const targetObject = objects.get(alias.targetObjectId);
    if (!targetObject) return;
    resolverAliasUris(alias.aliasUri).forEach((lookupUri) => {
      aliases.set(lookupUri, {
        aliasUri: lookupUri,
        targetObject,
        isActive: alias.isActive,
        replacementAliasUri: alias.replacementAliasUri
          ? resolverAliasUris(alias.replacementAliasUri)[0]
          : undefined,
      });
    });
  });

  const repository: LoomGraphMutationRepository = {
    findByObjectId(objectId) {
      return objects.get(objectId);
    },
    findByCanonicalUri(uri) {
      return Array.from(objects.values()).find((object) => object.canonicalUri === uri);
    },
    findByAliasUri(uri) {
      const alias = aliases.get(uri);
      return alias?.isActive ? alias.targetObject : undefined;
    },
    resolveAliasUri(uri) {
      return aliases.get(uri);
    },
    findPrimaryAlias(objectId) {
      const object = objects.get(objectId);
      if (!object) return undefined;
      const activeAlias = Array.from(aliases.values()).find(
        (alias) => alias.targetObject.objectId === objectId && alias.isActive
      );
      return activeAlias?.aliasUri ?? object.aliasUri;
    },
    findBookmarkByTargetObjectId(objectId) {
      return Array.from(objects.values()).find(
        (object) => object.kind === "bookmark" && object.targetObjectId === objectId
      );
    },
    findBookmarkByUri(uri) {
      const alias = aliases.get(uri);
      if (alias?.targetObject.kind === "bookmark") return alias.targetObject;
      return Array.from(objects.values()).find(
        (object) => object.kind === "bookmark" && object.aliasUri === uri
      );
    },
    registerAliasUri({ aliasUri, targetObjectId, replacementAliasUri }) {
      const targetObject = objects.get(targetObjectId);
      const aliasUris = resolverAliasUris(aliasUri);
      const replacementLookupUri = replacementAliasUri
        ? resolverAliasUris(replacementAliasUri)[0]
        : undefined;
      const existing = runtime.aliases.find((item) => aliasUris.includes(item.aliasUri));
      const isActive = replacementAliasUri === undefined;
      if (targetObject) {
        aliasUris.forEach((lookupUri) => {
          aliases.set(lookupUri, {
            aliasUri: lookupUri,
            targetObject,
            isActive,
            replacementAliasUri: replacementLookupUri,
          });
        });
      }
      const nextAliases = runtime.aliases.filter(
        (item) => !aliasUris.includes(item.aliasUri)
      );
      aliasUris.forEach((lookupUri) => {
        nextAliases.push({
          aliasUri: lookupUri,
          targetObjectId,
          isActive,
          replacementAliasUri: replacementLookupUri,
        });
      });
      persistRuntime({
        ...runtime,
        aliases: nextAliases,
      });
      const event: LoomLedgerEvent = {
        ledgerEventId: uniqueId("led"),
        eventType: existing ? "alias_updated" : "alias_created",
        objectId: targetObjectId,
        payload: {
          aliasUri,
          replacementAliasUri: replacementLookupUri,
          isActive,
        },
        createdAt: nowIso(),
      };
      appendLedgerEvents([event]);
      return event;
    },
    findRevision(objectId, revision) {
      if (revision === 1 && objects.has(objectId)) return true;
      return runtime.revisions.some(
        (item) => item.objectId === objectId && item.revision === revision
      );
    },
    findSnapshot(objectId, snapshot) {
      return runtime.revisions.some(
        (item) => item.objectId === objectId && item.snapshot === snapshot
      );
    },
    supportsWindow(objectId, windowType) {
      const object = objects.get(objectId);
      if (!object) return false;
      if (windowType === "conversation") return object.kind === "conversation";
      if (windowType === "loom" || windowType === "lineage") {
        return object.kind === "conversation" || object.kind === "response";
      }
      if (windowType === "reference" || windowType === "context") return true;
      if (windowType === "time") return true;
      return false;
    },
    getLineage(objectId) {
      const lineage: LoomResolvedObject[] = [];
      const seen = new Set<string>();
      let currentId: string | undefined = objectId;
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const object = objects.get(currentId);
        if (object) lineage.push(object);
        currentId = edges.find((edge) => edge.toObjectId === currentId)?.fromObjectId;
      }
      return lineage;
    },
    getDescendants(objectId) {
      const descendants: LoomResolvedObject[] = [];
      const queue = [objectId];
      const seen = new Set<string>(queue);
      while (queue.length) {
        const currentId = queue.shift();
        edges
          .filter((edge) => edge.fromObjectId === currentId)
          .forEach((edge) => {
            if (seen.has(edge.toObjectId)) return;
            seen.add(edge.toObjectId);
            queue.push(edge.toObjectId);
            const object = objects.get(edge.toObjectId);
            if (object) descendants.push(object);
          });
      }
      return descendants;
    },
    getReferenceNeighborhood(objectId) {
      return edges.filter(
        (edge) =>
          (edge.edgeType === "references" || edge.edgeType === "mentions") &&
          (edge.fromObjectId === objectId || edge.toObjectId === objectId)
      );
    },
    getWindowProjection(objectId, windowType): LoomWindowProjection | undefined {
      if (!this.supportsWindow(objectId, windowType)) return undefined;
      if (windowType === "conversation" || windowType === "loom" || windowType === "lineage") {
        return {
          windowType,
          anchorObjectId: objectId,
          objectIds: [objectId, ...this.getDescendants(objectId).map((object) => object.objectId)],
        };
      }
      if (windowType === "reference") {
        const neighborhood = this.getReferenceNeighborhood(objectId);
        return {
          windowType,
          anchorObjectId: objectId,
          objectIds: Array.from(
            new Set([
              objectId,
              ...neighborhood.flatMap((edge) => [edge.fromObjectId, edge.toObjectId]),
            ])
          ),
        };
      }
      return {
        windowType,
        anchorObjectId: objectId,
        objectIds: [objectId],
      };
    },
    promoteBookmark(link): LoomBookmarkPromotionResult {
      const resolved = resolveLoomAddress(link.path, repository);
      const targetObject =
        resolved.status === "resolved" && (resolved.targetObject ?? resolved.object)
          ? resolved.targetObject ?? resolved.object!
          : makeObject({
              kind: objectKindForUiType(link.type),
              id: link.id,
              title: link.title,
              aliasUri: link.path,
              status: link.badge === "Broken reference" ? "unreachable" : "active",
            });

      if (!objects.has(targetObject.objectId)) {
        appendRuntimeObjects([targetObject]);
        if (targetObject.aliasUri) {
          appendRuntimeAliases([
            {
              aliasUri: targetObject.aliasUri,
              targetObjectId: targetObject.objectId,
              isActive: true,
            },
          ]);
        }
      }

      const existingBookmark = repository.findBookmarkByTargetObjectId(targetObject.objectId);
      if (existingBookmark) {
        return {
          bookmark: {
            id: existingBookmark.objectId,
            type: "bookmark",
            title: existingBookmark.title,
            editableTitle: existingBookmark.title,
            path: existingBookmark.aliasUri ?? existingBookmark.canonicalUri,
            badge: "Bookmark",
            lastUsed: "Already saved",
            targetObjectId: targetObject.objectId,
            canonicalUri: existingBookmark.canonicalUri,
          },
          bookmarkObject: existingBookmark,
          targetObject,
          ledgerEvents: [],
        };
      }

      const bookmarkObject = makeObject({
        kind: "bookmark",
        id: uniqueId("bookmark"),
        title: link.title,
        aliasUri: `loom://bookmarks/${slugify(link.title)}-${Math.random().toString(36).slice(2, 6)}`,
        targetObjectId: targetObject.objectId,
      });
      const edge: LoomGraphEdge = {
        edgeId: uniqueId("edge"),
        fromObjectId: bookmarkObject.objectId,
        toObjectId: targetObject.objectId,
        edgeType: "bookmarked_as",
      };
      const createdAt = nowIso();
      const events: LoomLedgerEvent[] = [
        {
          ledgerEventId: uniqueId("led"),
          eventType: "bookmark_created",
          objectId: bookmarkObject.objectId,
          relatedObjectId: targetObject.objectId,
          payload: { title: link.title },
          createdAt,
        },
        {
          ledgerEventId: uniqueId("led"),
          eventType: "address_created",
          objectId: bookmarkObject.objectId,
          payload: { canonicalUri: bookmarkObject.canonicalUri },
          createdAt,
        },
        {
          ledgerEventId: uniqueId("led"),
          eventType: "alias_created",
          objectId: bookmarkObject.objectId,
          payload: { aliasUri: bookmarkObject.aliasUri },
          createdAt,
        },
      ];

      appendRuntimeObjects([bookmarkObject]);
      appendRuntimeAliases([
        {
          aliasUri: bookmarkObject.aliasUri ?? bookmarkObject.canonicalUri,
          targetObjectId: bookmarkObject.objectId,
          isActive: true,
        },
      ]);
      appendRuntimeEdges([edge]);
      appendLedgerEvents(events);

      return {
        bookmark: {
          id: bookmarkObject.objectId,
          type: link.type,
          title: link.title,
          editableTitle: link.title,
          path: bookmarkObject.aliasUri ?? bookmarkObject.canonicalUri,
          badge: link.badge ?? "Bookmark",
          lastUsed: "Just saved",
          targetObjectId: targetObject.objectId,
          canonicalUri: bookmarkObject.canonicalUri,
        },
        bookmarkObject,
        targetObject,
        ledgerEvents: events,
      };
    },
    createReferenceMention({ sourceConversationId, sourcePath, target }) {
      const resolved = resolveLoomAddress(target.path, repository);
      const targetObject = resolved.status === "resolved" ? resolved.targetObject ?? resolved.object : undefined;
      if (!targetObject) return undefined;
      const mentionObject = makeObject({
        kind: "reference_mention",
        id: uniqueId("mention"),
        title: `Reference to ${targetObject.title}`,
        targetObjectId: targetObject.objectId,
      });
      const mention: LoomReferenceMentionRecord = {
        mentionId: mentionObject.objectId,
        objectId: mentionObject.objectId,
        sourceConversationId,
        sourcePath,
        targetObjectId: targetObject.objectId,
        targetPath: targetObject.aliasUri ?? targetObject.canonicalUri,
        createdAt: nowIso(),
      };
      const sourceObject = repository.findByAliasUri(sourcePath);
      const mentionEdge: LoomGraphEdge = {
        edgeId: uniqueId("edge"),
        fromObjectId: mentionObject.objectId,
        toObjectId: targetObject.objectId,
        edgeType: "mentions",
      };
      const referenceEdge: LoomGraphEdge | undefined = sourceObject
        ? {
            edgeId: uniqueId("edge"),
            fromObjectId: sourceObject.objectId,
            toObjectId: targetObject.objectId,
            edgeType: "references",
          }
        : undefined;
      appendRuntimeObjects([mentionObject]);
      appendRuntimeEdges(referenceEdge ? [mentionEdge, referenceEdge] : [mentionEdge]);
      persistRuntime({
        ...runtime,
        referenceMentions: [...runtime.referenceMentions, mention],
      });
      appendLedgerEvents([
        {
          ledgerEventId: uniqueId("led"),
          eventType: "reference_mention_created",
          objectId: mentionObject.objectId,
          relatedObjectId: targetObject.objectId,
          payload: { sourceConversationId, sourcePath, targetPath: target.path },
          createdAt: mention.createdAt,
        },
      ]);
      return mention;
    },
    emitBrokenReference(target, reason) {
      const resolved = resolveLoomAddress(target.path, repository);
      const event: LoomLedgerEvent = {
        ledgerEventId: uniqueId("led"),
        eventType: "broken_reference_detected",
        objectId: resolved.object?.objectId,
        relatedObjectId: resolved.targetObject?.objectId,
        payload: { path: target.path, reason },
        createdAt: nowIso(),
      };
      appendLedgerEvents([event]);
      return event;
    },
    getLedgerEvents() {
      return runtime.ledgerEvents;
    },
  };

  return repository;
}
