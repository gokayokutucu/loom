import type { ReactNode } from "react";

export function TopBar({ children }: { children: ReactNode }) {
  return <header className="top-browser-bar">{children}</header>;
}
