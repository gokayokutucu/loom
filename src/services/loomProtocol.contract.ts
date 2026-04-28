import type {
  LoomAliasRecord,
  LoomGraphEdge,
  LoomGraphRepository,
  LoomResolutionStatus,
  LoomResolvedObject,
  LoomWindowProjection,
} from "../types";
import { canonicalLoomUri, resolveLoomAddress } from "./loomProtocol";

const responseObject: LoomResolvedObject = {
  objectId: "RSP_contract_response",
  kind: "response",
  status: "active",
  title: "Contract response",
  canonicalUri: canonicalLoomUri("response", "RSP_contract_response"),
  aliasUri: "loom://contracts/active-response",
};

const bookmarkObject: LoomResolvedObject = {
  objectId: "BMK_contract_bookmark",
  kind: "bookmark",
  status: "active",
  title: "Contract bookmark",
  canonicalUri: canonicalLoomUri("bookmark", "BMK_contract_bookmark"),
  aliasUri: "loom://bookmarks/contract-response",
  targetObjectId: responseObject.objectId,
};

const deletedObject: LoomResolvedObject = {
  objectId: "RSP_contract_deleted",
  kind: "response",
  status: "deleted",
  title: "Deleted contract response",
  canonicalUri: canonicalLoomUri("response", "RSP_contract_deleted"),
  aliasUri: "loom://contracts/deleted-response",
};

const unreachableObject: LoomResolvedObject = {
  objectId: "RSP_contract_unreachable",
  kind: "response",
  status: "unreachable",
  title: "Unreachable contract response",
  canonicalUri: canonicalLoomUri("response", "RSP_contract_unreachable"),
  aliasUri: "loom://contracts/unreachable-response",
};

const referenceMentionObject: LoomResolvedObject = {
  objectId: "RMN_contract_mention",
  kind: "reference_mention",
  status: "active",
  title: "Contract reference mention",
  canonicalUri: canonicalLoomUri("reference_mention", "RMN_contract_mention"),
  aliasUri: "loom://mentions/contract-response",
  targetObjectId: responseObject.objectId,
};

const objects = new Map(
  [responseObject, bookmarkObject, deletedObject, unreachableObject, referenceMentionObject].map(
    (object) => [object.objectId, object]
  )
);

const aliases = new Map<string, LoomAliasRecord>([
  [
    responseObject.aliasUri ?? "",
    {
      aliasUri: responseObject.aliasUri ?? "",
      targetObject: responseObject,
      isActive: true,
    },
  ],
  [
    bookmarkObject.aliasUri ?? "",
    {
      aliasUri: bookmarkObject.aliasUri ?? "",
      targetObject: bookmarkObject,
      isActive: true,
    },
  ],
  [
    "loom://contracts/old-response",
    {
      aliasUri: "loom://contracts/old-response",
      targetObject: responseObject,
      isActive: false,
      replacementAliasUri: responseObject.aliasUri,
    },
  ],
  [
    deletedObject.aliasUri ?? "",
    {
      aliasUri: deletedObject.aliasUri ?? "",
      targetObject: deletedObject,
      isActive: true,
    },
  ],
  [
    unreachableObject.aliasUri ?? "",
    {
      aliasUri: unreachableObject.aliasUri ?? "",
      targetObject: unreachableObject,
      isActive: true,
    },
  ],
  [
    referenceMentionObject.aliasUri ?? "",
    {
      aliasUri: referenceMentionObject.aliasUri ?? "",
      targetObject: referenceMentionObject,
      isActive: true,
    },
  ],
]);

const contractEdges: LoomGraphEdge[] = [
  {
    edgeId: "edge-contract-reference",
    fromObjectId: referenceMentionObject.objectId,
    toObjectId: responseObject.objectId,
    edgeType: "mentions",
  },
];

const contractRepository: LoomGraphRepository = {
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
    return objects.get(objectId)?.aliasUri;
  },
  findBookmarkByTargetObjectId(objectId) {
    return Array.from(objects.values()).find(
      (object) => object.kind === "bookmark" && object.targetObjectId === objectId
    );
  },
  findBookmarkByUri(uri) {
    const object = this.findByAliasUri(uri);
    return object?.kind === "bookmark" ? object : undefined;
  },
  findRevision(_objectId, revision) {
    return revision === 1;
  },
  findSnapshot(_objectId, snapshot) {
    return snapshot === "sha256:known";
  },
  supportsWindow(objectId, windowType) {
    const object = objects.get(objectId);
    if (!object) return false;
    if (windowType === "conversation") return object.kind === "conversation";
    if (windowType === "loom" || windowType === "lineage") return object.kind === "response";
    if (windowType === "reference" || windowType === "context" || windowType === "time") {
      return true;
    }
    return false;
  },
  getLineage(objectId) {
    const object = objects.get(objectId);
    return object ? [object] : [];
  },
  getDescendants() {
    return [];
  },
  getReferenceNeighborhood(objectId) {
    return contractEdges.filter(
      (edge) => edge.fromObjectId === objectId || edge.toObjectId === objectId
    );
  },
  getWindowProjection(objectId, windowType): LoomWindowProjection | undefined {
    if (!this.supportsWindow(objectId, windowType)) return undefined;
    return {
      anchorObjectId: objectId,
      objectIds: [objectId],
      windowType,
    };
  },
};

export const loomResolverContractScenarios: Array<{
  name: string;
  address: string;
  expectedStatus: LoomResolutionStatus;
  actualStatus: LoomResolutionStatus;
}> = [
  {
    name: "canonical object URI resolves by stable ID",
    address: responseObject.canonicalUri,
    expectedStatus: "resolved",
    actualStatus: resolveLoomAddress(responseObject.canonicalUri, contractRepository).status,
  },
  {
    name: "active pretty alias resolves to canonical object",
    address: responseObject.aliasUri ?? "",
    expectedStatus: "resolved",
    actualStatus: resolveLoomAddress(responseObject.aliasUri ?? "", contractRepository).status,
  },
  {
    name: "stale alias returns explicit stale state",
    address: "loom://contracts/old-response",
    expectedStatus: "alias_stale",
    actualStatus: resolveLoomAddress("loom://contracts/old-response", contractRepository).status,
  },
  {
    name: "deleted object returns deleted state",
    address: deletedObject.aliasUri ?? "",
    expectedStatus: "deleted",
    actualStatus: resolveLoomAddress(deletedObject.aliasUri ?? "", contractRepository).status,
  },
  {
    name: "unreachable object returns broken reference",
    address: unreachableObject.aliasUri ?? "",
    expectedStatus: "broken_reference",
    actualStatus: resolveLoomAddress(unreachableObject.aliasUri ?? "", contractRepository).status,
  },
  {
    name: "missing revision returns snapshot_missing",
    address: `${responseObject.aliasUri}?rev=99`,
    expectedStatus: "snapshot_missing",
    actualStatus: resolveLoomAddress(`${responseObject.aliasUri}?rev=99`, contractRepository).status,
  },
  {
    name: "missing snapshot returns snapshot_missing",
    address: `${responseObject.aliasUri}?snapshot=sha256:missing`,
    expectedStatus: "snapshot_missing",
    actualStatus: resolveLoomAddress(
      `${responseObject.aliasUri}?snapshot=sha256:missing`,
      contractRepository
    ).status,
  },
  {
    name: "invalid window returns window_invalid",
    address: `${responseObject.aliasUri}?window=conversation`,
    expectedStatus: "window_invalid",
    actualStatus: resolveLoomAddress(
      `${responseObject.aliasUri}?window=conversation`,
      contractRepository
    ).status,
  },
  {
    name: "bookmark resolves with target object semantics",
    address: bookmarkObject.aliasUri ?? "",
    expectedStatus: "resolved",
    actualStatus: resolveLoomAddress(bookmarkObject.aliasUri ?? "", contractRepository).status,
  },
  {
    name: "reference mention resolves without cloning target response",
    address: referenceMentionObject.aliasUri ?? "",
    expectedStatus: "resolved",
    actualStatus: resolveLoomAddress(
      referenceMentionObject.aliasUri ?? "",
      contractRepository
    ).status,
  },
];
