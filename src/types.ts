import type { LucideIcon } from "lucide-react";

export type LoomObjectType =
  | "conversation"
  | "loom"
  | "response"
  | "bookmark"
  | "semantic"
  | "recent";

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
