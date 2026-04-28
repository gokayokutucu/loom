import type { ReactNode } from "react";

export function AppShell({
  sidebarCollapsed,
  children,
  topBar,
  sidebar,
  workspace,
  rightPanel,
  overlays,
}: {
  sidebarCollapsed?: boolean;
  children?: ReactNode;
  topBar?: ReactNode;
  sidebar?: ReactNode;
  workspace?: ReactNode;
  rightPanel?: ReactNode;
  overlays?: ReactNode;
}) {
  if (children) {
    return (
      <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
        {children}
      </div>
    );
  }

  return (
    <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      {topBar}
      <div className="app-body">
        {sidebar}
        <main className="workspace">{workspace}</main>
        {rightPanel}
      </div>
      {overlays}
    </div>
  );
}
