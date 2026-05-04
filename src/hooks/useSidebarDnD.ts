import { useMemo, useState, type DragEvent } from "react";
import type { Conversation, TabGroup } from "../types";

export interface SidebarDnDOperations {
  createGroup: (sourceId: string, targetId: string) => void;
  addToGroup: (conversationId: string, groupId: string) => void;
  removeFromGroups: (conversationId: string) => void;
}

export function useSidebarDnD({
  conversations,
  pinnedConversationIds,
  tabGroups,
  operations,
}: {
  conversations: Conversation[];
  pinnedConversationIds: string[];
  tabGroups: TabGroup[];
  operations: SidebarDnDOperations;
}) {
  const [draggedConversationId, setDraggedConversationId] = useState<string | null>(null);
  const [groupingPreviewId, setGroupingPreviewId] = useState<string | null>(null);
  const [groupDropTargetId, setGroupDropTargetId] = useState<string | null>(null);
  const [standaloneDropActive, setStandaloneDropActive] = useState(false);

  const pinnedIds = useMemo(
    () => new Set(pinnedConversationIds),
    [pinnedConversationIds]
  );

  function getGroupIdForConversation(conversationId: string) {
    return tabGroups.find((group) => group.conversationIds.includes(conversationId))?.id;
  }

  function isPinned(conversationId: string) {
    return pinnedIds.has(conversationId);
  }

  function canSidebarDropOnConversation(sourceId: string, targetId: string) {
    if (sourceId === targetId) return false;
    if (isPinned(sourceId) || isPinned(targetId)) return false;
    return Boolean(conversations.some((item) => item.id === sourceId));
  }

  function startDrag(conversationId: string) {
    setDraggedConversationId(conversationId);
  }

  function endDrag() {
    setDraggedConversationId(null);
    setGroupingPreviewId(null);
    setGroupDropTargetId(null);
    setStandaloneDropActive(false);
  }

  function handleConversationDragEnter(targetId: string) {
    if (!draggedConversationId || !canSidebarDropOnConversation(draggedConversationId, targetId)) {
      return;
    }
    setGroupingPreviewId(targetId);
  }

  function handleConversationDragOver(event: DragEvent, targetId: string) {
    if (!draggedConversationId || !canSidebarDropOnConversation(draggedConversationId, targetId)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleConversationDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setGroupingPreviewId(null);
    }
  }

  function handleConversationDrop(event: DragEvent, targetId: string) {
    if (!draggedConversationId || !canSidebarDropOnConversation(draggedConversationId, targetId)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const sourceGroupId = getGroupIdForConversation(draggedConversationId);
    const targetGroupId = getGroupIdForConversation(targetId);
    setGroupingPreviewId(null);

    if (!sourceGroupId && !targetGroupId) {
      operations.createGroup(draggedConversationId, targetId);
      return;
    }

    if (!sourceGroupId && targetGroupId) {
      operations.addToGroup(draggedConversationId, targetGroupId);
    }
  }

  function handleGroupDragEnter(groupId: string) {
    if (!draggedConversationId || isPinned(draggedConversationId)) return;
    if (getGroupIdForConversation(draggedConversationId)) return;
    setGroupDropTargetId(groupId);
  }

  function handleGroupDragOver(event: DragEvent, groupId: string) {
    if (!draggedConversationId || isPinned(draggedConversationId)) return;
    const sourceGroupId = getGroupIdForConversation(draggedConversationId);
    if (sourceGroupId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleGroupDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setGroupDropTargetId(null);
    }
  }

  function handleGroupDrop(event: DragEvent, groupId: string) {
    if (!draggedConversationId || isPinned(draggedConversationId)) return;
    const sourceGroupId = getGroupIdForConversation(draggedConversationId);
    if (sourceGroupId) return;
    event.preventDefault();
    event.stopPropagation();
    operations.addToGroup(draggedConversationId, groupId);
    setGroupDropTargetId(null);
  }

  function handleStandaloneDragEnter() {
    if (draggedConversationId) setStandaloneDropActive(true);
  }

  function handleStandaloneDragOver(event: DragEvent) {
    if (!draggedConversationId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleStandaloneDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setStandaloneDropActive(false);
    }
  }

  function handleStandaloneDrop(event: DragEvent) {
    if (!draggedConversationId) return;
    event.preventDefault();
    event.stopPropagation();
    if (getGroupIdForConversation(draggedConversationId)) {
      operations.removeFromGroups(draggedConversationId);
    }
    setStandaloneDropActive(false);
  }

  return {
    draggedConversationId,
    groupingPreviewId,
    groupDropTargetId,
    standaloneDropActive,
    getGroupIdForConversation,
    startDrag,
    endDrag,
    handleConversationDragEnter,
    handleConversationDragOver,
    handleConversationDragLeave,
    handleConversationDrop,
    handleGroupDragEnter,
    handleGroupDragOver,
    handleGroupDragLeave,
    handleGroupDrop,
    handleStandaloneDragEnter,
    handleStandaloneDragOver,
    handleStandaloneDragLeave,
    handleStandaloneDrop,
  };
}
