import type { LucideIcon } from "lucide-react";

export type LoomObjectType =
  | "conversation"
  | "loom"
  | "response"
  | "bookmark"
  | "semantic"
  | "recent";

export type LoomObjectKind =
  | "conversation"
  | "response"
  | "quick_question"
  | "bookmark"
  | "fragment"
  | "reference_mention";

export type LoomWindowType =
  | "conversation"
  | "loom"
  | "reference"
  | "time"
  | "context"
  | "lineage";

export type LoomObjectStatus = "active" | "archived" | "deleted" | "unreachable";

export type LoomResolutionStatus =
  | "resolved"
  | "not_found"
  | "deleted"
  | "alias_stale"
  | "snapshot_missing"
  | "window_invalid"
  | "broken_reference";

export interface LoomAddressSelector {
  revision?: number;
  snapshot?: string;
  view?: LoomWindowType;
  window?: LoomWindowType;
  fragment?: string;
}

export interface LoomAddressParseResult {
  raw: string;
  kind: "canonical" | "alias";
  objectKind?: LoomObjectKind;
  objectId?: string;
  aliasUri?: string;
  selector: LoomAddressSelector;
}

export interface LoomResolvedObject {
  objectId: string;
  kind: LoomObjectKind;
  status: LoomObjectStatus;
  title: string;
  canonicalUri: string;
  aliasUri?: string;
  targetObjectId?: string;
}

export interface LoomResolutionResult {
  status: LoomResolutionStatus;
  parsed: LoomAddressParseResult;
  object?: LoomResolvedObject;
  targetObject?: LoomResolvedObject;
  canonicalUri?: string;
  aliasUri?: string;
  staleAliasReplacement?: string;
  reason?: string;
}

export interface LoomGraphRepository {
  findByObjectId(objectId: string): LoomResolvedObject | undefined;
  findByCanonicalUri(uri: string): LoomResolvedObject | undefined;
  findByAliasUri(uri: string): LoomResolvedObject | undefined;
  findPrimaryAlias(objectId: string): string | undefined;
  findRevision(objectId: string, revision: number): boolean;
  findSnapshot(objectId: string, snapshot: string): boolean;
  supportsWindow(objectId: string, windowType: LoomWindowType): boolean;
}

export interface Conversation {
  id: string;
  title: string;
  path: string;
  folder: string;
  summary: string;
  iconKey?: string;
  iconColor?: string;
  pinned?: boolean;
  unread?: boolean;
}

export interface LoomLink {
  id: string;
  type: LoomObjectType;
  title: string;
  path: string;
  badge?: string;
}

export interface ResponseItem {
  id: string;
  title: string;
  address: string;
  question: string;
  answer: string[];
  suggestedLinks: LoomLink[];
  bookmarkedLinks: LoomLink[];
  bookmarked?: boolean;
}

export interface BookmarkItem extends LoomLink {
  lastUsed: string;
  editableTitle: string;
}

export interface HistoryEntry extends LoomLink {
  visitedAt: string;
}

export interface TabGroup {
  id: string;
  name: string;
  conversationIds: string[];
  collapsed?: boolean;
}

export interface AddressSuggestion extends LoomLink {
  subtitle: string;
  iconLabel: string;
}

export interface PanelAction {
  id: string;
  label: string;
  Icon: LucideIcon;
}
