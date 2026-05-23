import { Copy } from "lucide-react";
import type { CSSProperties } from "react";
import type { LoomLink } from "../types";
import { canonicalReferenceAddress, referenceCodeForLink } from "../services/referenceDisplay";

function previewReferencedText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 500) return normalized;
  return `${normalized.slice(0, 499).trim()}…`;
}

export function AddressHintPopover({
  link,
  style,
  closing = false,
  placement = "top",
  onEnter,
  onCopy,
  onClose,
}: {
  link: LoomLink;
  style: CSSProperties;
  closing?: boolean;
  placement?: "top" | "bottom";
  onEnter?: () => void;
  onCopy?: (link: Pick<LoomLink, "path" | "canonicalUri">) => void;
  onClose?: () => void;
}) {
  const code = referenceCodeForLink(link);
  const address = canonicalReferenceAddress(link);
  const addressKind = link.canonicalUri ?? link.meta?.canonicalUri ? "canonical" : "temporary";
  const selectedTextPreview =
    link.type === "fragment" && link.selectedText
      ? previewReferencedText(link.selectedText)
      : "";

  return (
    <div
      className={closing ? "address-hint-popover closing" : "address-hint-popover"}
      data-testid="address-hint-popover"
      data-placement={placement}
      style={style}
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onClose}
    >
      <span>{link.badge ?? link.type}</span>
      <strong>{link.title}</strong>
      {selectedTextPreview && (
        <div className="address-hint-fragment">
          <span>Referenced text</span>
          <p className="address-hint-fragment-preview">
            {selectedTextPreview}
          </p>
        </div>
      )}
      {code && <em>{code}</em>}
      <div
        className={`address-hint-address ${addressKind}`}
        data-address-kind={addressKind}
      >
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
