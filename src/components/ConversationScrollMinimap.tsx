import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";
import {
  conversationMinimapLabel,
  minimapAnchorPercent,
  minimapViewportGeometry,
  nearestConversationMinimapItemId,
  type MinimapViewportGeometry,
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
}

interface ConversationScrollMinimapProps {
  scrollContainerRef: RefObject<HTMLElement | null>;
  items: ConversationMinimapItem[];
}

interface MeasuredMinimapItem extends ConversationMinimapItem {
  topPercent: number;
  anchorTop: number;
}

const MIN_ITEM_COUNT = 3;

function cssEscape(value: string) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/"/g, '\\"');
}

export function responseMinimapItems(
  responses: Array<{ id: string; title?: string; question?: string; answerText?: string }>,
  activeResponseId?: string | null
): ConversationMinimapItem[] {
  return responses.flatMap((response) => {
    const escapedId = cssEscape(response.id);
    const promptLabel = conversationMinimapLabel({
      type: "user",
      promptText: response.question,
    });
    const responseLabel = conversationMinimapLabel({
      type: "response",
      title: response.title,
      promptText: response.question,
      responseText: response.answerText,
    });
    return [
      {
        id: `${response.id}:user`,
        type: "user" as const,
        label: promptLabel,
        anchorSelector: `[data-prompt-response-id="${escapedId}"]`,
        active: activeResponseId === response.id,
      },
      {
        id: `${response.id}:response`,
        type: "response" as const,
        label: responseLabel,
        anchorSelector: `[data-response-id="${escapedId}"]`,
        active: activeResponseId === response.id,
      },
    ];
  });
}

export function ConversationScrollMinimap({
  scrollContainerRef,
  items,
}: ConversationScrollMinimapProps) {
  const [measuredItems, setMeasuredItems] = useState<MeasuredMinimapItem[]>([]);
  const [viewport, setViewport] = useState<MinimapViewportGeometry>({
    topPercent: 0,
    heightPercent: 100,
  });
  const [nearestItemId, setNearestItemId] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const visible = items.length >= MIN_ITEM_COUNT;

  const itemSignature = useMemo(
    () => items.map((item) => `${item.id}:${item.active ? "1" : "0"}`).join("|"),
    [items]
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !visible) {
      setMeasuredItems([]);
      setViewport({ topPercent: 0, heightPercent: 100 });
      return;
    }

    const measure = () => {
      rafRef.current = null;
      const nextItems = items
        .map((item) => {
          const anchor = container.querySelector<HTMLElement>(item.anchorSelector);
          if (!anchor) return null;
          return {
            ...item,
            anchorTop: anchor.offsetTop,
            topPercent: minimapAnchorPercent(anchor.offsetTop, container.scrollHeight),
          };
        })
        .filter((item): item is MeasuredMinimapItem => item !== null);
      setMeasuredItems(nextItems);
      setViewport(
        minimapViewportGeometry({
          scrollTop: container.scrollTop,
          clientHeight: container.clientHeight,
          scrollHeight: container.scrollHeight,
        })
      );
      setNearestItemId(
        nearestConversationMinimapItemId(nextItems, container.scrollTop)
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

  if (!visible || measuredItems.length === 0) return null;

  function scrollToAnchor(anchorTop: number) {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: Math.max(0, anchorTop - 24),
      behavior: "smooth",
    });
  }

  function scrollTrackTo(event: MouseEvent<HTMLDivElement>) {
    const container = scrollContainerRef.current;
    const track = trackRef.current;
    if (!container || !track || event.target !== track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    container.scrollTo({
      top: ratio * Math.max(0, container.scrollHeight - container.clientHeight),
      behavior: "smooth",
    });
  }

  return (
    <nav className="conversation-minimap" aria-label="Conversation scroll map">
      <div
        className="conversation-minimap__track"
        ref={trackRef}
        onClick={scrollTrackTo}
        aria-hidden="false"
      >
        <div
          className="conversation-minimap__viewport"
          style={{
            top: `${viewport.topPercent}%`,
            height: `${viewport.heightPercent}%`,
          }}
        />
        {measuredItems.map((item) => (
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
            style={{ top: `${item.topPercent}%` }}
            type="button"
          />
        ))}
        <div className="conversation-minimap__outline">
          {measuredItems.map((item) => {
            const active = item.active || item.highlighted || item.id === nearestItemId;
            return (
              <button
                aria-label={`Jump to ${item.type}: ${item.label}`}
                className={[
                  "conversation-minimap__outline-row",
                  active ? "conversation-minimap__outline-row--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={`${item.id}:outline`}
                onClick={(event) => {
                  event.stopPropagation();
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
                <span className="conversation-minimap__outline-type">{item.type}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
