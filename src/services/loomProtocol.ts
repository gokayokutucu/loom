/*
 * Address parsing helpers remain UI/client utilities, but local resolution
 * runtime in this module is legacy/dev/test-only after the Rust-authoritative
 * cutover. Product resolution must go through
 * LoomEngineClient -> RustHttpLoomEngineClient -> loom-service.
 */
import type {
  BookmarkItem,
  Conversation,
  LoomAliasRecord,
  LoomAddressParseResult,
  LoomGraphEdge,
  LoomGraphRepository,
  LoomLink,
  LoomObjectKind,
  LoomObjectType,
  LoomResolutionResult,
  LoomResolvedObject,
  LoomWindowProjection,
  LoomWindowType,
  ResponseItem,
} from "../types";

export function toLoomMarkdown(link: Pick<LoomLink, "title" | "path">) {
  return `[${link.title}](${link.path})`;
}

export function isLoomAddress(value: string) {
  return value.startsWith("loom://");
}

export function normalizeLoomTitle(title: string) {
  return title.trim().replace(/\s+/g, " ");
}

const canonicalObjectTypeMap: Record<string, LoomObjectKind> = {
  conversation: "conversation",
  response: "response",
  bookmark: "bookmark",
  fragment: "fragment",
  quick_question: "quick_question",
  "quick-question": "quick_question",
  reference_mention: "reference_mention",
  "reference-mention": "reference_mention",
};

const windowTypes = new Set<LoomWindowType>([
  "conversation",
  "loom",
  "reference",
  "time",
  "context",
  "lineage",
]);

function normalizeWindowType(value: string | null): LoomWindowType | undefined {
  if (!value) return undefined;
  return windowTypes.has(value as LoomWindowType)
    ? (value as LoomWindowType)
    : undefined;
}

export function parseLoomAddress(raw: string): LoomAddressParseResult {
  const trimmed = raw.trim();
  const selector: LoomAddressParseResult["selector"] = {};

  try {
    const url = new URL(trimmed);
    const revision = url.searchParams.get("rev");
    if (revision && Number.isFinite(Number(revision))) {
      selector.revision = Number(revision);
    }
    selector.snapshot = url.searchParams.get("snapshot") ?? undefined;
    selector.view = normalizeWindowType(url.searchParams.get("view"));
    selector.window = normalizeWindowType(url.searchParams.get("window"));
    selector.fragment = url.hash ? url.hash.slice(1) : undefined;

    if (url.protocol === "loom:" && url.hostname === "o") {
      const [kindPart, objectId] = url.pathname.split("/").filter(Boolean);
      const objectKind = canonicalObjectTypeMap[kindPart];
      if (objectKind && objectId) {
        return {
          raw: trimmed,
          kind: "canonical",
          objectKind,
          objectId,
          selector,
        };
      }
    }

    if (url.protocol === "loom:") {
      return {
        raw: trimmed,
        kind: "alias",
        aliasUri: `${url.protocol}//${url.host}${url.pathname}`,
        selector,
      };
    }
  } catch {
    // Fall through to alias handling so invalid URLs fail through the resolver.
  }

  return {
    raw: trimmed,
    kind: "alias",
    aliasUri: trimmed,
    selector,
  };
}

export function canonicalLoomUri(kind: LoomObjectKind, objectId: string) {
  return `loom://o/${kind}/${objectId}`;
}

export function resolveLoomAddress(
  raw: string,
  repository: LoomGraphRepository
): LoomResolutionResult {
  const parsed = parseLoomAddress(raw);
  const aliasRecord =
    parsed.kind === "alias" && parsed.aliasUri
      ? repository.resolveAliasUri(parsed.aliasUri)
      : undefined;
  const object =
    parsed.kind === "canonical" && parsed.objectId
      ? repository.findByObjectId(parsed.objectId) ??
        repository.findByCanonicalUri(raw)
      : aliasRecord?.targetObject ??
        (parsed.aliasUri ? repository.findByAliasUri(parsed.aliasUri) : undefined);

  if (aliasRecord && !aliasRecord.isActive) {
    return {
      status: "alias_stale",
      parsed,
      object: aliasRecord.targetObject,
      canonicalUri: aliasRecord.targetObject.canonicalUri,
      aliasUri: aliasRecord.targetObject.aliasUri,
      staleAliasReplacement: aliasRecord.replacementAliasUri,
      reason: "The alias resolves, but it is retired or no longer the active primary alias.",
    };
  }

  const bookmarkTarget =
    object?.kind === "bookmark" && object.targetObjectId
      ? repository.findByObjectId(object.targetObjectId)
        : undefined;

  if (!object) {
    return {
      status: "not_found",
      parsed,
      reason: "No canonical object or active alias matched the Loom address.",
    };
  }

  if (object.status === "deleted") {
    return {
      status: "deleted",
      parsed,
      object,
      canonicalUri: object.canonicalUri,
      aliasUri: object.aliasUri,
      reason: "The target object was deleted.",
    };
  }

  if (object.status === "unreachable") {
    return {
      status: "broken_reference",
      parsed,
      object,
      canonicalUri: object.canonicalUri,
      aliasUri: object.aliasUri,
      reason: "The target object is unreachable from the current graph state.",
    };
  }

  if (bookmarkTarget?.status === "deleted") {
    return {
      status: "deleted",
      parsed,
      object,
      targetObject: bookmarkTarget,
      canonicalUri: object.canonicalUri,
      aliasUri: object.aliasUri,
      reason: "The bookmark target object was deleted.",
    };
  }

  if (bookmarkTarget?.status === "unreachable") {
    return {
      status: "broken_reference",
      parsed,
      object,
      targetObject: bookmarkTarget,
      canonicalUri: object.canonicalUri,
      aliasUri: object.aliasUri,
      reason: "The bookmark target object is unreachable.",
    };
  }

  const primaryAlias = repository.findPrimaryAlias(object.objectId);
  if (
    parsed.kind === "alias" &&
    primaryAlias &&
    parsed.aliasUri &&
    primaryAlias !== parsed.aliasUri &&
    object.aliasUri !== parsed.aliasUri
  ) {
    return {
      status: "alias_stale",
      parsed,
      object,
      canonicalUri: object.canonicalUri,
      aliasUri: object.aliasUri,
      staleAliasReplacement: primaryAlias,
      reason: "The alias resolves, but it is not the current primary alias.",
    };
  }

  const requestedWindow = parsed.selector.window ?? parsed.selector.view;
  if (requestedWindow && !repository.supportsWindow(object.objectId, requestedWindow)) {
    return {
      status: "window_invalid",
      parsed,
      object,
      canonicalUri: object.canonicalUri,
      aliasUri: object.aliasUri,
      reason: "The object resolved, but the requested window is not valid for it.",
    };
  }

  if (
    parsed.selector.revision !== undefined &&
    !repository.findRevision(object.objectId, parsed.selector.revision)
  ) {
    return {
      status: "snapshot_missing",
      parsed,
      object,
      canonicalUri: object.canonicalUri,
      aliasUri: object.aliasUri,
      reason: "The requested revision is not available.",
    };
  }

  if (
    parsed.selector.snapshot &&
    !repository.findSnapshot(object.objectId, parsed.selector.snapshot)
  ) {
    return {
      status: "snapshot_missing",
      parsed,
      object,
      canonicalUri: object.canonicalUri,
      aliasUri: object.aliasUri,
      reason: "The requested snapshot is not available.",
    };
  }

  return {
    status: "resolved",
    parsed,
    object,
    targetObject: bookmarkTarget,
    canonicalUri: object.canonicalUri,
    aliasUri: object.aliasUri,
  };
}

function objectIdFor(type: LoomObjectKind, id: string) {
  const prefix: Record<LoomObjectKind, string> = {
    conversation: "CNV",
    response: "RSP",
    quick_question: "QQ",
    bookmark: "BMK",
    fragment: "FRG",
    reference_mention: "RMN",
  };
  return `${prefix[type]}_${id}`;
}

function uiTypeForKind(kind: LoomObjectKind): LoomObjectType {
  if (kind === "conversation") return "conversation";
  if (kind === "bookmark") return "bookmark";
  return "response";
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

export function createMockLoomGraphRepository({
  conversations,
  responsesByConversation,
  bookmarks,
}: {
  conversations: Conversation[];
  responsesByConversation: Record<string, ResponseItem[]>;
  bookmarks: BookmarkItem[];
}): LoomGraphRepository {
  const objects = new Map<string, LoomResolvedObject>();
  const canonical = new Map<string, LoomResolvedObject>();
  const aliases = new Map<string, LoomAliasRecord>();
  const edges: LoomGraphEdge[] = [];
  const conversationObjectIds = new Map<string, string>();

  function addObject(object: LoomResolvedObject) {
    objects.set(object.objectId, object);
    canonical.set(object.canonicalUri, object);
    if (object.aliasUri) {
      aliases.set(object.aliasUri, {
        aliasUri: object.aliasUri,
        targetObject: object,
        isActive: true,
      });
    }
  }

  function addEdge(fromObjectId: string, toObjectId: string, edgeType: LoomGraphEdge["edgeType"]) {
    edges.push({
      edgeId: `edge-${edges.length + 1}`,
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
    conversationObjectIds.set(conversation.id, object.objectId);
  });

  Object.entries(responsesByConversation).forEach(([conversationId, responses]) => {
    responses.forEach((response) => {
      const object = makeObject({
        kind: "response",
        id: `${conversationId}_${response.id}`,
        title: response.title,
        aliasUri: response.address,
      });
      addObject(object);
      const conversationObjectId = conversationObjectIds.get(conversationId);
      if (conversationObjectId) addEdge(conversationObjectId, object.objectId, "contains");
    });
  });

  bookmarks.forEach((bookmark) => {
    const target = aliases.get(bookmark.path)?.targetObject;
    addObject(
      makeObject({
        kind: "bookmark",
        id: bookmark.id,
        title: bookmark.editableTitle,
        aliasUri: bookmark.path,
        status: bookmark.badge === "Broken reference" ? "unreachable" : "active",
        targetObjectId: target?.objectId,
      })
    );
  });

  return {
    findByObjectId(objectId) {
      return objects.get(objectId);
    },
    findByCanonicalUri(uri) {
      return canonical.get(uri);
    },
    findByAliasUri(uri) {
      const alias = aliases.get(uri);
      return alias?.isActive ? alias.targetObject : undefined;
    },
    resolveAliasUri(uri) {
      return aliases.get(uri);
    },
    findPrimaryAlias(objectId) {
      return objects.get(objectId)?.aliasUri;
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
    findRevision(objectId, revision) {
      return Boolean(objects.get(objectId)) && revision >= 1;
    },
    findSnapshot(objectId, snapshot) {
      return Boolean(objects.get(objectId)) && snapshot.startsWith("sha256:");
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
  };
}

export function linkFromResolvedObject(object: LoomResolvedObject): LoomLink {
  return {
    id: object.objectId,
    type: uiTypeForKind(object.kind),
    title: object.title,
    path: object.aliasUri ?? object.canonicalUri,
    badge:
      object.kind === "conversation"
        ? "Loom"
        : object.kind === "bookmark"
          ? "Bookmark"
          : "Response",
  };
}
