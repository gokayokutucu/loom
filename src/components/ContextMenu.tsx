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
        {state.items.map((item, index) => {
          const hasChildren = Boolean(item.children?.length);
          return (
            <div
              key={`${item.id}-${index}-${item.label}`}
              className={[
                "context-menu-entry",
                item.separatorBefore ? "separated" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                className={[
                  "context-menu-item",
                  item.danger ? "danger" : "",
                  hasChildren ? "has-submenu" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={item.disabled}
                onClick={() => {
                  if (hasChildren) return;
                  onAction(item, index);
                }}
                role="menuitem"
                aria-haspopup={hasChildren ? "menu" : undefined}
              >
                <span>{item.label}</span>
                {item.detail && <small>{item.detail}</small>}
              </button>
              {hasChildren && !item.disabled && (
                <div className="context-submenu" role="menu">
                  {item.children?.map((child, childIndex) => (
                    <button
                      key={`${child.id}-${child.targetGroupId ?? childIndex}-${child.label}`}
                      className={[
                        "context-menu-item",
                        child.danger ? "danger" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={child.disabled}
                      onClick={() => onAction(child, childIndex)}
                      role="menuitem"
                    >
                      <span>{child.label}</span>
                      {child.detail && <small>{child.detail}</small>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
