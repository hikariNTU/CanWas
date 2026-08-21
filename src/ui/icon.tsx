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
      // A hook for the tests, which need to find every icon on screen and
      // measure it — one glyph wide means the ligature resolved, a word wide
      // means the font never arrived. It is an attribute rather than the class
      // list so that how an icon is styled and how it is found stay
      // independent.
      data-icon=""
      // Spelled out here rather than kept as a class in the stylesheet: this
      // is the only element in the app that is ever a Material Symbol, so the
      // rule had exactly one use site and reading it meant opening a second
      // file. `glass` earns its place there by being thirty-one use sites of
      // one decision; this was never that.
      //
      // The glyph is chosen by a ligature, so the text must survive untouched:
      // no capitalisation, no letter-spacing, no wrapping, and `translate="no"`
      // above. `block`, not inline: an inline box is positioned against the
      // text baseline, which lifts the glyph above the label beside it, while
      // as a block it is laid out — and centred — by its flex or grid parent.
      className={clsx(
        'block font-["Material_Symbols_Rounded"] font-bold not-italic',
        "[font-variation-settings:'FILL'_0,'wght'_700,'GRAD'_0,'opsz'_24]",
        "[font-feature-settings:'liga']",
        "leading-none tracking-normal normal-case whitespace-nowrap",
        "[direction:ltr] [word-wrap:normal] select-none antialiased",
        className,
      )}
      style={{ fontSize: size }}
    >
      {name}
    </span>
  );
}
