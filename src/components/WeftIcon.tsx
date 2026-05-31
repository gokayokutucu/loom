/**
 * WeftIcon — nf-fa-code_fork (U+F126) from Nerd Fonts.
 *
 * Requires the Nerd Fonts webfont CSS to be loaded (index.html).
 * Falls back gracefully if the font is not available — the browser
 * renders the Private Use Area character invisibly or as a box,
 * which is acceptable while the font loads.
 *
 * Usage:
 *   <WeftIcon size={13} />
 *   <WeftIcon size={16} color="currentColor" />
 */
export function WeftIcon({
  size = 16,
  color = "currentColor",
  style,
  className,
  "aria-hidden": ariaHidden = true,
}: {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  return (
    <span
      className={["nf", "nf-fa-code_fork", className].filter(Boolean).join(" ")}
      aria-hidden={ariaHidden}
      style={{
        fontSize: size,
        color,
        lineHeight: 1,
        display: "inline-block",
        fontStyle: "normal",
        ...style,
      }}
    />
  );
}
