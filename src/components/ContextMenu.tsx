import type { ContextMenuItem, ContextMenuPayload } from "../services/contextMenu";

export interface ContextMenuState {
  x: number;
  y: number;
  payload: ContextMenuPayload;
  items: ContextMenuItem[];
}

export function ContextMenu({
  state,
  onAction,
  onClose,
}: {
  state: ContextMenuState;
  onAction: (item: ContextMenuItem, index: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="context-menu-backdrop"
      role="presentation"
      onContextMenu={(event) => event.preventDefault()}
      onClick={onClose}
    >
      <div
        className="context-menu"
        role="menu"
        style={{ left: state.x, top: state.y }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {state.items.map((item, index) => (
          <button
            key={`${item.id}-${index}-${item.label}`}
            className={[
              "context-menu-item",
              item.danger ? "danger" : "",
              item.separatorBefore ? "separated" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={item.disabled}
            onClick={() => onAction(item, index)}
            role="menuitem"
          >
            <span>{item.label}</span>
            {item.detail && <small>{item.detail}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
