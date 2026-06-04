import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
  anchorSelector: string;
  active?: boolean;
  highlighted?: boolean;
  outlineChildren?: ConversationMinimapOutlineChild[];
}

export interface ConversationMinimapOutlineChild {
  id: string;
  type: "revision";
  label: string;
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
    const label = conversationMinimapLabel({
      type: "response",
      title: response.title || response.question || response.answerText,
    });
    return {
      id: `${response.id}:response`,
      type: "response" as const,
      label,
      anchorSelector: `[data-prompt-response-id="${escapedId}"]`,
      active: activeResponseId === response.id,
      outlineChildren: (response.revisions ?? []).map((revision, index) => ({
        id: `${response.id}:revision:${revision.id}`,
        type: "revision" as const,
        label: conversationMinimapRevisionLabel(revision, index + 2),
        responseId: response.id,
        revisionIndex: index + 1,
        childConversationId: revision.childConversationId,
      })),
    };
  });
}

export function ConversationScrollMinimap({
  scrollContainerRef,
  items,
  onRevisionSelect,
}: ConversationScrollMinimapProps) {
  const [measuredItems, setMeasuredItems] = useState<MeasuredMinimapItem[]>([]);
  const [nearestItemId, setNearestItemId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const outlineRef = useRef<HTMLDivElement | null>(null);
  const visible = items.length >= MIN_ITEM_COUNT;

  const itemSignature = useMemo(
    () => items.map((item) => `${item.id}:${item.active ? "1" : "0"}`).join("|"),
    [items]
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !visible) {
      setMeasuredItems([]);
      setNearestItemId(null);
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
      setNearestItemId(
        nearestConversationMinimapItemId(anchorItems, container.scrollTop)
      );
    };

    const scheduleMeasure = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    container.addEventListener("scroll", scheduleMeasure, { passive: true });
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
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
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

  if (!visible || measuredItems.length === 0) return null;
  const rulerItems = visibleMinimapRulerWindow(measuredItems, nearestItemId).map(
    (item, index) => ({
      ...item,
      topPx: minimapRulerTickTopPx(index),
    })
  );

  function scrollToAnchor(anchorTop: number) {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: Math.max(0, anchorTop - 24),
      behavior: "smooth",
    });
  }

  return (
    <nav
      className="conversation-minimap"
      aria-label="Conversation scroll map"
      style={{ height: `${MINIMAP_RULER_HEIGHT_PX}px` }}
    >
      <div className="conversation-minimap__track" aria-hidden="false">
        {rulerItems.map((item) => (
          <button
            aria-label={`Jump to ${item.type}: ${item.label}`}
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
              scrollToAnchor(item.anchorTop);
            }}
            style={{ top: `${item.topPx}px` }}
            type="button"
          />
        ))}
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
                  className={[
                    "conversation-minimap__outline-row",
                    active ? "conversation-minimap__outline-row--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={(event) => {
                    event.stopPropagation();
                    alignOutlineRowNearTop(event.currentTarget);
                    scrollToAnchor(item.anchorTop);
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
                  <span className="conversation-minimap__outline-label">{item.label}</span>
                </button>
                {item.outlineChildren?.map((child) => (
                  <button
                    aria-label={`Open revision: ${child.label}`}
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
                    <span className="conversation-minimap__outline-label">{child.label}</span>
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
