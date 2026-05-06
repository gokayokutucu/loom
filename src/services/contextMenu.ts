import type { BookmarkItem, Conversation, HistoryEntry, LoomLink, ResponseItem, TabGroup } from "../types";

export type ContextMenuKind =
  | "conversation"
  | "response"
  | "bookmark"
  | "history-entry"
  | "group"
  | "history-back"
  | "history-forward";

export type ContextMenuAction =
  | "open"
  | "pin"
  | "unpin"
  | "rename"
  | "change-icon"
  | "set-group-color"
  | "bookmark"
  | "copy-address"
  | "copy-markdown"
  | "archive"
  | "delete"
  | "ask"
  | "link"
  | "bookmark-suggested"
  | "open-graph"
  | "insert"
  | "remove"
  | "move-to-group"
  | "new-tab-group"
  | "move-group-window"
  | "ungroup"
  | "delete-group"
  | "visit-history";

export interface ContextMenuItem {
  id: ContextMenuAction;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  detail?: string;
  targetGroupId?: string;
  children?: ContextMenuItem[];
}

export type ContextMenuPayload =
  | { kind: "conversation"; conversation: Conversation; pinned: boolean }
  | { kind: "response"; response: ResponseItem }
  | { kind: "bookmark"; bookmark: BookmarkItem }
  | { kind: "history-entry"; entry: HistoryEntry }
  | { kind: "group"; group: TabGroup }
  | { kind: "history-back" | "history-forward"; entries: HistoryEntry[] };

export interface ContextMenuRequest {
  kind: ContextMenuKind;
  payload: ContextMenuPayload;
}

export function getContextMenuItems(payload: ContextMenuPayload): ContextMenuItem[] {
  switch (payload.kind) {
    case "conversation":
      return [
        { id: "open", label: "Open" },
        { id: payload.pinned ? "unpin" : "pin", label: payload.pinned ? "Unpin" : "Pin" },
        { id: "rename", label: "Rename" },
        { id: "change-icon", label: "Change Icon..." },
        { id: "bookmark", label: "Bookmark" },
        { id: "copy-address", label: "Copy Loom Address" },
        { id: "archive", label: "Archive", separatorBefore: true },
        { id: "delete", label: "Delete", danger: true },
      ];
    case "response":
      return [
        { id: "ask", label: "Ask" },
        { id: "copy-address", label: "Copy Loom Address" },
        { id: "copy-markdown", label: "Copy as Loom Markdown" },
        {
          id: "bookmark-suggested",
          label: "Bookmark suggested links",
          disabled: payload.response.suggestedLinks.length === 0,
        },
        { id: "rename", label: "Rename title" },
        { id: "open-graph", label: "Open in Graph View" },
      ];
    case "bookmark":
      return [
        { id: "open", label: "Open" },
        { id: "insert", label: "Link" },
        { id: "rename", label: "Rename bookmark" },
        { id: "copy-address", label: "Copy Loom Address" },
        { id: "remove", label: "Remove bookmark", danger: true, separatorBefore: true },
      ];
    case "history-entry":
      return [
        { id: "open", label: "Open" },
        { id: "insert", label: "Link" },
        { id: "bookmark", label: "Bookmark" },
        { id: "copy-address", label: "Copy Loom Address" },
      ];
    case "group":
      return [
        { id: "rename", label: "Edit / Rename Group" },
        { id: "set-group-color", label: "Set Color..." },
        { id: "new-tab-group", label: "New Tab in Group" },
        {
          id: "move-group-window",
          label: "Move Group to New Window",
          detail: "Ready for desktop shell",
          disabled: true,
        },
        { id: "ungroup", label: "Ungroup", separatorBefore: true },
        {
          id: "delete-group",
          label: "Delete Group",
          detail: "Keeps conversations",
          danger: true,
        },
      ];
    case "history-back":
    case "history-forward":
      return payload.entries.length > 0
        ? payload.entries.map((entry) => ({
            id: "visit-history",
            label: entry.title,
            detail: entry.path,
          }))
        : [{ id: "visit-history", label: "No destinations", disabled: true }];
  }
}

export function toLinkFromResponse(response: ResponseItem): LoomLink {
  return {
    id: response.id,
    type: "response",
    title: response.title,
    path: response.address,
    badge: "Linked",
    canonicalUri: response.meta?.canonicalUri,
    meta: response.meta,
    referenceCode: response.meta?.code,
  };
}
