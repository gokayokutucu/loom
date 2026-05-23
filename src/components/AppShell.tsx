import type { ReactNode } from "react";

export function AppShell({
  sidebarCollapsed,
  theme,
  children,
  topBar,
  sidebar,
  workspace,
  rightPanel,
  overlays,
}: {
  sidebarCollapsed?: boolean;
  theme?: string;
  children?: ReactNode;
  topBar?: ReactNode;
  sidebar?: ReactNode;
  workspace?: ReactNode;
  rightPanel?: ReactNode;
  overlays?: ReactNode;
}) {
  const className = [theme, "app-shell", sidebarCollapsed ? "sidebar-collapsed" : ""]
    .filter(Boolean)
    .join(" ");

  if (children) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className}>
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
