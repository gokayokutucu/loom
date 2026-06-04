import { useEffect, useMemo, useRef, useState, useLayoutEffect, type RefObject } from "react";
import {
  conversationMinimapLabel,
  conversationMinimapRevisionLabel,
  MINIMAP_RULER_HEIGHT_PX,
  minimapRulerTickTopPx,
  nearestConversationMinimapItemId,
  visibleMinimapRulerWindow,
} from "../services/conversationMinimap";

export type ConversationMinimapItemType =
  | "user"
  | "response"
  | "queued"
  | "running"
  | "revision"
  | "weft";

export interface ConversationMinimapItem {
  id: string;
  type: ConversationMinimapItemType;
  label: string;
  fullLabel?: string;
  anchorSelector: string;
  active?: boolean;
  highlighted?: boolean;
  outlineChildren?: ConversationMinimapOutlineChild[];
}

export interface ConversationMinimapOutlineChild {
  id: string;
  type: "revision";
  label: string;
  fullLabel?: string;
  responseId: string;
  revisionIndex: number;
  childConversationId: string;
}

interface ConversationScrollMinimapProps {
  scrollContainerRef: RefObject<HTMLElement | null>;
  items: ConversationMinimapItem[];
  onRevisionSelect?: (
    responseId: string,
    revisionIndex: number,
    childConversationId: string
  ) => void;
}

interface MeasuredMinimapItem extends ConversationMinimapItem {
  anchorTop: number;
}

const MIN_ITEM_COUNT = 2;

function cssEscape(value: string) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/"/g, '\\"');
}

export function responseMinimapItems(
  responses: Array<{
    id: string;
    title?: string;
    question?: string;
    answerText?: string;
    revisions?: Array<{
      id: string;
      childConversationId: string;
      title?: string | null;
      revisionPrompt?: string | null;
    }>;
  }>,
  activeResponseId?: string | null
): ConversationMinimapItem[] {
  return responses.map((response) => {
    const escapedId = cssEscape(response.id);
    const labelInput = {
      type: "response" as const,
      title: response.title || response.question || response.answerText,
    };
    const label = conversationMinimapLabel(labelInput);
    const fullLabel = conversationMinimapLabel({ ...labelInput, truncate: false });
    return {
      id: `${response.id}:response`,
      type: "response" as const,
      label,
      fullLabel,
      anchorSelector: `[data-prompt-response-id="${escapedId}"]`,
      active: activeResponseId === response.id,
      outlineChildren: (response.revisions ?? []).map((revision, index) => {
        const rLabel = conversationMinimapRevisionLabel(revision, index + 2);
        const rFullLabel = conversationMinimapRevisionLabel(revision, index + 2, false);
        return {
          id: `${response.id}:revision:${revision.id}`,
          type: "revision" as const,
          label: rLabel,
          fullLabel: rFullLabel,
          responseId: response.id,
          revisionIndex: index + 1,
          childConversationId: revision.childConversationId,
        };
      }),
    };
  });
}

export function ConversationScrollMinimap({
  scrollContainerRef,
  items,
  onRevisionSelect,
}: ConversationScrollMinimapProps) {
  const [measuredItems, setMeasuredItems] = useState<MeasuredMinimapItem[]>([]);
  const [nearestItemIdState, setNearestItemIdState] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const outlineRef = useRef<HTMLDivElement | null>(null);
  const visible = items.length >= MIN_ITEM_COUNT;

  const isExplicitJumpRef = useRef(false);
  const jumpTargetIdRef = useRef<string | null>(null);
  const jumpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measuredItemsRef = useRef<MeasuredMinimapItem[]>([]);

  const nearestItemId = jumpTargetIdRef.current ?? nearestItemIdState;

  useEffect(() => {
    measuredItemsRef.current = measuredItems;
  }, [measuredItems]);

  const itemSignature = useMemo(
    () => items.map((item) => `${item.id}:${item.active ? "1" : "0"}`).join("|"),
    [items]
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !visible) {
      setMeasuredItems([]);
      setNearestItemIdState(null);
      return;
    }

    const measure = () => {
      rafRef.current = null;
      const anchorItems = items
        .map((item) => {
          const anchor = container.querySelector<HTMLElement>(item.anchorSelector);
          if (!anchor) return null;
          return {
            ...item,
            anchorTop: anchor.offsetTop,
          };
        })
        .filter((item): item is MeasuredMinimapItem => item !== null);
      setMeasuredItems(anchorItems);

      const computedNearest = nearestConversationMinimapItemId(anchorItems, container.scrollTop);
      setNearestItemIdState(computedNearest);

      // Release lock if we get close to the destination
      if (jumpTargetIdRef.current) {
        const targetItem = anchorItems.find(item => item.id === jumpTargetIdRef.current);
        if (targetItem) {
          const targetScrollTop = Math.max(0, targetItem.anchorTop - 24);
          const atBottom = Math.abs(container.scrollTop + container.clientHeight - container.scrollHeight) < 4;
          const atTop = container.scrollTop === 0;
          if (
            Math.abs(container.scrollTop - targetScrollTop) < 4 ||
            (atBottom && targetScrollTop > container.scrollTop) ||
            (atTop && targetScrollTop < container.scrollTop)
          ) {
            jumpTargetIdRef.current = null;
            isExplicitJumpRef.current = false;
            if (jumpTimeoutRef.current) {
              clearTimeout(jumpTimeoutRef.current);
            }
          }
        } else {
          jumpTargetIdRef.current = null;
          isExplicitJumpRef.current = false;
          if (jumpTimeoutRef.current) {
            clearTimeout(jumpTimeoutRef.current);
          }
        }
      }
    };

    const scheduleMeasure = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(measure);
    };

    const handleUserScrollIntent = () => {
      if (jumpTargetIdRef.current || isExplicitJumpRef.current) {
        jumpTargetIdRef.current = null;
        isExplicitJumpRef.current = false;
        if (jumpTimeoutRef.current) {
          clearTimeout(jumpTimeoutRef.current);
        }
        setNearestItemIdState(
          nearestConversationMinimapItemId(measuredItemsRef.current, container.scrollTop)
        );
      }
    };

    scheduleMeasure();
    container.addEventListener("scroll", scheduleMeasure, { passive: true });
    container.addEventListener("wheel", handleUserScrollIntent, { passive: true });
    container.addEventListener("touchstart", handleUserScrollIntent, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(container);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      container.removeEventListener("scroll", scheduleMeasure);
      container.removeEventListener("wheel", handleUserScrollIntent);
      container.removeEventListener("touchstart", handleUserScrollIntent);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (jumpTimeoutRef.current) {
        clearTimeout(jumpTimeoutRef.current);
      }
    };
  }, [itemSignature, items, scrollContainerRef, visible]);

  function alignOutlineRowNearTop(row: HTMLElement | null) {
    const outline = outlineRef.current;
    if (!outline || !row || outline.scrollHeight <= outline.clientHeight) return;
    outline.scrollTo({
      top: Math.max(0, row.offsetTop - 8),
      behavior: "smooth",
    });
  }

  function alignActiveOutlineRowIfOpen() {
    const outline = outlineRef.current;
    if (!outline) return;
    const active = outline.querySelector<HTMLElement>(
      ".conversation-minimap__outline-row--active"
    );
    alignOutlineRowNearTop(active);
  }

  useEffect(() => {
    const outline = outlineRef.current;
    if (!outline) return;
    if (!outline.matches(":hover") && !outline.closest(".conversation-minimap:focus-within")) {
      return;
    }
    const frame = window.requestAnimationFrame(alignActiveOutlineRowIfOpen);
    return () => window.cancelAnimationFrame(frame);
  }, [nearestItemId, measuredItems]);

  const fullRulerWindow = visibleMinimapRulerWindow(measuredItems, nearestItemId);
  const startIndex = Math.max(
    0,
    measuredItems.findIndex((item) => item.id === fullRulerWindow[0]?.id)
  );

  const [transformOffset, setTransformOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevStartIndexRef = useRef<number>(startIndex);

  useLayoutEffect(() => {
    const prevStartIndex = prevStartIndexRef.current;
    prevStartIndexRef.current = startIndex;

    if (prevStartIndex !== startIndex && isExplicitJumpRef.current) {
      const diff = (prevStartIndex - startIndex) * 16;
      setTransformOffset(diff);
      setIsAnimating(false);

      const frame = requestAnimationFrame(() => {
        setTransformOffset(0);
        setIsAnimating(true);
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setTransformOffset(0);
      setIsAnimating(false);
    }
  }, [startIndex]);

  if (!visible || measuredItems.length === 0) return null;

  const rulerItems = fullRulerWindow.map((item, index) => ({
    ...item,
    topPx: index * 16,
  }));

  function scrollToAnchor(anchorTop: number) {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: Math.max(0, anchorTop - 24),
      behavior: "smooth",
    });
  }

  function triggerExplicitJump(itemId: string, anchorTop: number) {
    if (jumpTimeoutRef.current) {
      clearTimeout(jumpTimeoutRef.current);
    }
    isExplicitJumpRef.current = true;
    jumpTargetIdRef.current = itemId;
    setNearestItemIdState(itemId);

    scrollToAnchor(anchorTop);

    jumpTimeoutRef.current = setTimeout(() => {
      jumpTargetIdRef.current = null;
      isExplicitJumpRef.current = false;
      const container = scrollContainerRef.current;
      if (container) {
        setNearestItemIdState(nearestConversationMinimapItemId(measuredItems, container.scrollTop));
      }
    }, 1000);
  }

  return (
    <nav
      className="conversation-minimap"
      aria-label="Conversation scroll map"
      style={{ height: `${MINIMAP_RULER_HEIGHT_PX}px` }}
    >
      <div className="conversation-minimap__track" aria-hidden="false">
        <div
          className={[
            "conversation-minimap__ticks-container",
            isAnimating ? "conversation-minimap__ticks-container--animating" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            transform: transformOffset !== 0 ? `translateY(${transformOffset}px)` : undefined,
          }}
        >
          {rulerItems.map((item) => (
            <button
              aria-label={`Jump to ${item.type}: ${item.label}`}
              title={item.fullLabel || item.label}
              className={[
                "conversation-minimap__tick",
                `conversation-minimap__tick--${item.type}`,
                item.active || item.highlighted || item.id === nearestItemId
                  ? "conversation-minimap__tick--active"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={item.id}
              onClick={(event) => {
                event.stopPropagation();
                triggerExplicitJump(item.id, item.anchorTop);
              }}
              style={{ top: `${item.topPx}px` }}
              type="button"
            />
          ))}
        </div>
        <div
          className="conversation-minimap__outline"
          onMouseEnter={() => {
            window.requestAnimationFrame(alignActiveOutlineRowIfOpen);
          }}
          ref={outlineRef}
        >
          {measuredItems.map((item) => {
            const active = item.active || item.highlighted || item.id === nearestItemId;
            return (
              <div className="conversation-minimap__outline-group" key={`${item.id}:outline`}>
                <button
                  aria-label={`Jump to ${item.type}: ${item.label}`}
                  title={item.fullLabel || item.label}
                  className={[
                    "conversation-minimap__outline-row",
                    active ? "conversation-minimap__outline-row--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={(event) => {
                    event.stopPropagation();
                    alignOutlineRowNearTop(event.currentTarget);
                    triggerExplicitJump(item.id, item.anchorTop);
                  }}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={[
                      "conversation-minimap__outline-marker",
                      `conversation-minimap__outline-marker--${item.type}`,
                    ].join(" ")}
                  />
                  <span
                    title={item.fullLabel || item.label}
                    className="conversation-minimap__outline-label"
                  >
                    {item.label}
                  </span>
                </button>
                {item.outlineChildren?.map((child) => (
                  <button
                    aria-label={`Open revision: ${child.label}`}
                    title={child.fullLabel || child.label}
                    className="conversation-minimap__outline-row conversation-minimap__outline-row--child conversation-minimap__outline-row--revision"
                    key={child.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      alignOutlineRowNearTop(event.currentTarget);
                      onRevisionSelect?.(
                        child.responseId,
                        child.revisionIndex,
                        child.childConversationId
                      );
                    }}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="conversation-minimap__outline-marker conversation-minimap__outline-marker--revision"
                    />
                    <span
                      title={child.fullLabel || child.label}
                      className="conversation-minimap__outline-label"
                    >
                      {child.label}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
