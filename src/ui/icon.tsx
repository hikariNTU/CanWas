import clsx from "clsx";

/**
 * A Material Symbol.
 *
 * The glyph is selected by a ligature — the element's text *is* the icon name —
 * so `name` must be a Material Symbols identifier, in snake_case.
 *
 * Weight comes from the font's `wght` axis rather than from a stroke width
 * prop, which is why this replaced an SVG icon set: 700 genuinely thickens the
 * strokes instead of scaling a thin glyph up.
 */
export function Icon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      translate="no"
      className={clsx("material-symbol", className)}
      style={{ fontSize: size }}
    >
      {name}
    </span>
  );
}
