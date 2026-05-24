import { Copy } from "lucide-react";
import type { CSSProperties } from "react";
import type { LoomLink } from "../types";
import {
  addressBarReferenceAddress,
  canonicalReferenceAddress,
  isLoomReferenceAddress,
  referenceCodeForLink,
} from "../services/referenceDisplay";

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
  const originalAddress = canonicalReferenceAddress(link);
  const address = addressBarReferenceAddress(link);
  const addressAvailable = isLoomReferenceAddress(address);
  const addressKind =
    addressAvailable && (link.canonicalUri ?? link.meta?.canonicalUri)
      ? "canonical"
      : "temporary";
  const addressLabel = address === originalAddress ? "Loom address" : "Source Loom address";
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
        <span className="address-hint-address-label">{addressLabel}</span>
        <code>{addressAvailable ? address : "Loom address unavailable"}</code>
        {addressAvailable && onCopy && (
          <button
            type="button"
            aria-label={`Copy ${addressLabel}`}
            title={`Copy ${addressLabel}`}
            onClick={() =>
              onCopy({
                path: address,
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
