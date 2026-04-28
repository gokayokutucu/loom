import { useEffect, useRef, useState } from "react";
import { Bot, CornerDownLeft, X } from "lucide-react";
import type { ResponseItem } from "../types";

export interface AskPopupState {
  response: ResponseItem;
  selectedText: string;
  question: string;
  answered: boolean;
  answer?: string;
  error?: string;
  running?: boolean;
}

export function AskPopup({
  state,
  onUpdate,
  onClose,
  onBookmark,
  onLoom,
  onSubmit,
}: {
  state: AskPopupState;
  onUpdate: (state: AskPopupState) => void;
  onClose: () => void;
  onBookmark: () => void;
  onLoom: () => void;
  onSubmit: () => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!dragRef.current) return;
      const width = 460;
      const nextX = Math.min(
        window.innerWidth - 24,
        Math.max(24 - width, event.clientX - dragRef.current.offsetX)
      );
      const nextY = Math.min(
        window.innerHeight - 120,
        Math.max(48, event.clientY - dragRef.current.offsetY)
      );
      setPosition({ x: nextX, y: nextY });
    }

    function handlePointerUp() {
      dragRef.current = null;
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const popover = event.currentTarget.closest(".ask-popover");
    if (!(popover instanceof HTMLElement)) return;
    const rect = popover.getBoundingClientRect();
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setPosition({ x: rect.left, y: rect.top });
  }

  return (
    <div
      className="ask-popover"
      style={
        position
          ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
          : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-title"
    >
      <div className="ask-header ask-drag-handle" onPointerDown={startDrag}>
        <div>
          <span>Ask</span>
          <h2 id="ask-title">{state.response.title}</h2>
        </div>
        <button
          className="icon-button"
          tabIndex={0}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label="Close Ask"
        >
          <X size={16} />
        </button>
      </div>
      <blockquote>{state.selectedText}</blockquote>
      <textarea
        ref={textareaRef}
        value={state.question}
        onChange={(event) => onUpdate({ ...state, question: event.target.value })}
        placeholder="Ask a focused follow-up about this selection..."
        aria-label="Ask question"
        tabIndex={0}
      />
      {state.answered && (
        <div className="ask-answer">
          <Bot size={15} />
          <p>{state.answer}</p>
        </div>
      )}
      {state.error && <p className="ask-error">{state.error}</p>}
      <div className="ask-actions">
        <button tabIndex={0} onClick={onLoom}>Convert to Loom</button>
        <button tabIndex={0} onClick={onBookmark}>Bookmark</button>
        <button
          className="primary"
          tabIndex={0}
          onClick={onSubmit}
          disabled={state.running}
        >
          <CornerDownLeft size={15} />
          {state.running ? "Asking..." : "Ask"}
        </button>
      </div>
    </div>
  );
}
