import type { ReactNode } from "react";

export function BookmarkView({
  dragActive,
  children,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  dragActive: boolean;
  children: ReactNode;
  onDragEnter: React.DragEventHandler<HTMLDivElement>;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className={dragActive ? "panel-list bookmark-drop-target drag-over" : "panel-list bookmark-drop-target"}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}
