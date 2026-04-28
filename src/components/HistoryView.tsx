import type { ReactNode } from "react";

export function HistoryView({ children }: { children: ReactNode }) {
  return <div className="panel-list">{children}</div>;
}
