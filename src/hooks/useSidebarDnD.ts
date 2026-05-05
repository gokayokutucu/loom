import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { Conversation, TabGroup } from "../types";

export interface SidebarDnDOperations {
  createGroup: (sourceId: string, targetId: string) => void;
  addToGroup: (conversationId: string, groupId: string) => void;
  removeFromGroups: (conversationId: string) => void;
}

export type SidebarDropIntent = "createGroup" | "joinGroup" | "leaveGroup" | "moveGroup";
export type SidebarArmedIntent = "createGroup";
export type SidebarDropFeedback = "holdToGroup" | SidebarDropIntent;

interface PendingDropIntent {
  intent: SidebarDropIntent;
  targetKey: string;
  targetId?: string;
  groupId?: string;
}

const GROUP_HOVER_DELAY_MS = 1000;

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
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);
  const [hoverStartedAt, setHoverStartedAt] = useState<number | null>(null);
  const [armedIntent, setArmedIntent] = useState<SidebarArmedIntent | null>(null);
  const [dropFeedbackIntent, setDropFeedbackIntent] = useState<SidebarDropFeedback | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const pendingIntentRef = useRef<PendingDropIntent | null>(null);

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

  function clearHoverTimer() {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }

  function clearHoverState() {
    clearHoverTimer();
    pendingIntentRef.current = null;
    setHoverTargetId(null);
    setHoverStartedAt(null);
    setArmedIntent(null);
    setDropFeedbackIntent(null);
    setGroupingPreviewId(null);
    setGroupDropTargetId(null);
    setStandaloneDropActive(false);
  }

  function canSidebarDropOnConversation(sourceId: string, targetId: string) {
    if (sourceId === targetId) return false;
    if (isPinned(sourceId) || isPinned(targetId)) return false;
    return Boolean(conversations.some((item) => item.id === sourceId));
  }

  function getConversationIntent(sourceId: string, targetId: string): PendingDropIntent | null {
    if (!canSidebarDropOnConversation(sourceId, targetId)) return null;
    const sourceGroupId = getGroupIdForConversation(sourceId);
    const targetGroupId = getGroupIdForConversation(targetId);
    const targetKey = `conversation:${targetId}`;

    if (!sourceGroupId && !targetGroupId) {
      return { intent: "createGroup", targetKey, targetId };
    }

    if (!sourceGroupId && targetGroupId) {
      return { intent: "joinGroup", targetKey, targetId, groupId: targetGroupId };
    }

    if (sourceGroupId && !targetGroupId) {
      return { intent: "leaveGroup", targetKey, targetId };
    }

    if (sourceGroupId && targetGroupId && sourceGroupId !== targetGroupId) {
      return { intent: "moveGroup", targetKey, targetId, groupId: targetGroupId };
    }

    return null;
  }

  function getGroupIntent(sourceId: string, groupId: string): PendingDropIntent | null {
    if (isPinned(sourceId)) return null;
    if (!tabGroups.some((group) => group.id === groupId)) return null;
    const sourceGroupId = getGroupIdForConversation(sourceId);
    if (sourceGroupId === groupId) return null;
    return {
      intent: sourceGroupId ? "moveGroup" : "joinGroup",
      targetKey: `group:${groupId}`,
      groupId,
    };
  }

  function getStandaloneIntent(sourceId: string): PendingDropIntent | null {
    if (isPinned(sourceId) || !getGroupIdForConversation(sourceId)) return null;
    return { intent: "leaveGroup", targetKey: "standalone" };
  }

  function setImmediateFeedback(intent: PendingDropIntent | null) {
    if (!intent) {
      clearHoverState();
      return;
    }
    clearHoverTimer();
    pendingIntentRef.current = intent;
    setHoverTargetId(intent.targetKey);
    setHoverStartedAt(null);
    setArmedIntent(null);
    setDropFeedbackIntent(intent.intent);
    setGroupingPreviewId(intent.targetId ?? null);
    setGroupDropTargetId(intent.groupId ?? null);
    setStandaloneDropActive(intent.intent === "leaveGroup");
  }

  function beginCreateGroupHover(intent: PendingDropIntent | null) {
    if (!draggedConversationId || intent?.intent !== "createGroup") {
      clearHoverState();
      return;
    }

    if (pendingIntentRef.current?.targetKey === intent.targetKey) return;

    clearHoverTimer();
    pendingIntentRef.current = intent;
    setHoverTargetId(intent.targetKey);
    setHoverStartedAt(Date.now());
    setArmedIntent(null);
    setDropFeedbackIntent("holdToGroup");
    setGroupingPreviewId(intent.targetId ?? null);
    setGroupDropTargetId(null);
    setStandaloneDropActive(false);

    hoverTimerRef.current = window.setTimeout(() => {
      if (pendingIntentRef.current?.targetKey === intent.targetKey) {
        setArmedIntent("createGroup");
        setDropFeedbackIntent("createGroup");
      }
      hoverTimerRef.current = null;
    }, GROUP_HOVER_DELAY_MS);
  }

  function intentIsArmed(intent: PendingDropIntent | null) {
    return Boolean(
      intent?.intent === "createGroup" &&
        armedIntent === "createGroup" &&
        pendingIntentRef.current?.targetKey === intent.targetKey
    );
  }

  function updateDragFeedback(intent: PendingDropIntent | null) {
    if (intent?.intent === "createGroup") {
      beginCreateGroupHover(intent);
      return;
    }
    setImmediateFeedback(intent);
  }

  function startDrag(conversationId: string) {
    clearHoverState();
    setDraggedConversationId(conversationId);
  }

  function endDrag() {
    setDraggedConversationId(null);
    clearHoverState();
  }

  function handleConversationDragEnter(targetId: string) {
    if (!draggedConversationId) return;
    updateDragFeedback(getConversationIntent(draggedConversationId, targetId));
  }

  function handleConversationDragOver(event: DragEvent, targetId: string) {
    if (!draggedConversationId) return;
    const intent = getConversationIntent(draggedConversationId, targetId);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    updateDragFeedback(intent);
  }

  function handleConversationDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      clearHoverState();
    }
  }

  function handleConversationDrop(event: DragEvent, targetId: string) {
    if (!draggedConversationId) return;
    const intent = getConversationIntent(draggedConversationId, targetId);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();

    if (intent.intent === "createGroup") {
      if (intentIsArmed(intent)) {
        operations.createGroup(draggedConversationId, targetId);
      }
    }

    if ((intent.intent === "joinGroup" || intent.intent === "moveGroup") && intent.groupId) {
      operations.addToGroup(draggedConversationId, intent.groupId);
    }

    if (intent.intent === "leaveGroup") {
      operations.removeFromGroups(draggedConversationId);
    }

    clearHoverState();
  }

  function handleGroupDragEnter(groupId: string) {
    if (!draggedConversationId) return;
    updateDragFeedback(getGroupIntent(draggedConversationId, groupId));
  }

  function handleGroupDragOver(event: DragEvent, groupId: string) {
    if (!draggedConversationId) return;
    const intent = getGroupIntent(draggedConversationId, groupId);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    updateDragFeedback(intent);
  }

  function handleGroupDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      clearHoverState();
    }
  }

  function handleGroupDrop(event: DragEvent, groupId: string) {
    if (!draggedConversationId) return;
    const intent = getGroupIntent(draggedConversationId, groupId);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    if (intent.intent === "joinGroup" || intent.intent === "moveGroup") {
      operations.addToGroup(draggedConversationId, groupId);
    }
    clearHoverState();
  }

  function handleStandaloneDragEnter() {
    if (!draggedConversationId) return;
    updateDragFeedback(getStandaloneIntent(draggedConversationId));
  }

  function handleStandaloneDragOver(event: DragEvent) {
    if (!draggedConversationId) return;
    const intent = getStandaloneIntent(draggedConversationId);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    updateDragFeedback(intent);
  }

  function handleStandaloneDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      clearHoverState();
    }
  }

  function handleStandaloneDrop(event: DragEvent) {
    if (!draggedConversationId) return;
    const intent = getStandaloneIntent(draggedConversationId);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    if (intent.intent === "leaveGroup") {
      operations.removeFromGroups(draggedConversationId);
    }
    clearHoverState();
  }

  useEffect(() => {
    if (!draggedConversationId) return;

    function handleGlobalDragOver(event: globalThis.DragEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('[data-dnd-context="composer"]')) {
        clearHoverState();
        return;
      }
      if (!target.closest('[data-dnd-context="sidebar"]')) {
        clearHoverState();
      }
    }

    window.addEventListener("dragover", handleGlobalDragOver);
    window.addEventListener("dragenter", handleGlobalDragOver);
    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
      window.removeEventListener("dragenter", handleGlobalDragOver);
    };
  }, [draggedConversationId]);

  useEffect(() => () => clearHoverTimer(), []);

  return {
    draggedConversationId,
    groupingPreviewId,
    groupDropTargetId,
    standaloneDropActive,
    hoverTargetId,
    hoverStartedAt,
    armedIntent,
    dropFeedbackIntent,
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
