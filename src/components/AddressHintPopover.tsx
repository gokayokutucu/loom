import { Copy } from "lucide-react";
import type { CSSProperties } from "react";
import type { LoomLink } from "../types";
import { canonicalReferenceAddress, referenceCodeForLink } from "../services/referenceDisplay";

export function AddressHintPopover({
  link,
  style,
  onCopy,
  onClose,
}: {
  link: LoomLink;
  style: CSSProperties;
  onCopy?: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onClose?: () => void;
}) {
  const code = referenceCodeForLink(link);
  const address = canonicalReferenceAddress(link);

  return (
    <div
      className="address-hint-popover"
      data-testid="address-hint-popover"
      style={style}
      role="tooltip"
      onMouseLeave={onClose}
    >
      <span>{link.badge ?? link.type}</span>
      <strong>{link.title}</strong>
      {code && <em>{code}</em>}
      <div className="address-hint-address">
        <code>{address}</code>
        {onCopy && (
          <button
            type="button"
            aria-label="Copy Loom Address"
            title="Copy Loom Address"
            onClick={() =>
              onCopy({
                path: link.path,
                canonicalUri: link.canonicalUri ?? link.meta?.canonicalUri,
              })
            }
          >
            <Copy size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
