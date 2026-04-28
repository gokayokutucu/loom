export function SelectionPopover({
  x,
  y,
  onAsk,
  onQuickQuestion,
}: {
  x: number;
  y: number;
  onAsk: () => void;
  onQuickQuestion: () => void;
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
        Ask to Loom
      </button>
      <button
        type="button"
        tabIndex={0}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onQuickQuestion}
      >
        Quick Question
      </button>
    </div>
  );
}
