import { MessageSquarePlus, PlusCircle, Zap } from "lucide-react";

export function SelectionPopover({
  x,
  y,
  onAsk,
  onQuickQuestion,
  onAddReference,
}: {
  x: number;
  y: number;
  onAsk: () => void;
  onQuickQuestion: () => void;
  onAddReference: () => void;
}) {
  return (
    <div
      className="selection-action-popover"
      style={{ left: x, top: y }}
      role="toolbar"
      aria-label="Selection actions"
    >
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAsk}
      >
        <MessageSquarePlus size={13} aria-hidden="true" />
        Ask to Loom
      </button>
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onQuickQuestion}
      >
        <Zap size={13} aria-hidden="true" />
        Quick Question
      </button>
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAddReference}
      >
        <PlusCircle size={13} aria-hidden="true" />
        Add as Reference
      </button>
    </div>
  );
}
