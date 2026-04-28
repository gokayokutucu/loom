import type { ReactNode } from "react";

export function ReferencesListBox({ children }: { children: ReactNode }) {
  return <div className="linked-reference-list">{children}</div>;
}
