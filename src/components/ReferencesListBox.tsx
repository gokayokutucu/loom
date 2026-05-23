import type { HTMLAttributes, ReactNode } from "react";

export function ReferencesListBox({
  children,
  className,
  ...props
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={["linked-reference-list", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}
