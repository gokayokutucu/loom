/**
 * WeftIcon — nf-fa-code_fork (U+F126) from Nerd Fonts Symbols.
 *
 * Requires public/fonts/SymbolsNerdFont-Regular.woff2 (bundled locally,
 * @font-face defined in styles.css). No CDN, no network dependency.
 *
 * Drop-in replacement for lucide-react icons — accepts the same props.
 */
export function WeftIcon({
  size = 16,
  color = "currentColor",
  className,
  style,
  "aria-hidden": ariaHidden = true,
}: {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  return (
    <span
      aria-hidden={ariaHidden}
      className={className}
      style={{
        fontFamily: '"Symbols Nerd Font"',
        fontSize: size,
        color,
        lineHeight: 1,
        display: "inline-block",
        fontStyle: "normal",
        fontWeight: "normal",
        fontVariant: "normal",
        textTransform: "none",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
        ...style,
      }}
    >
      {""}
    </span>
  );
}
