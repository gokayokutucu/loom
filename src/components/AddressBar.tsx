import type { ReactNode, RefObject } from "react";

export function AddressBar({
  focused,
  addressBarRef,
  children,
}: {
  focused: boolean;
  addressBarRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={addressBarRef}
      className={focused ? "address-cluster focused" : "address-cluster"}
    >
      {children}
    </div>
  );
}
