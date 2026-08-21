import clsx from "clsx";

import { Icon } from "@/ui/icon";

/**
 * The insides of a glass panel: the controls and the rules between them.
 *
 * Everything floating over the canvas is translucent and blurred (`.glass` in
 * index.css), and the panels inherited a treatment that predates it — a solid
 * `neutral-800` border around every button and a `neutral-800` rule between
 * sections. A fixed grey on top of a surface that is already tinted and
 * showing the board through it reads as a seam rather than as a division: it
 * is the one colour in the panel that does not move when the background does.
 *
 * So the divisions are white at a low alpha, which tints with whatever is
 * behind them, and the buttons carry no border at all — they are found by
 * their icon and confirmed by a wash of white on hover, the way a control on
 * frosted glass behaves in Apple's own chrome. It costs the resting state its
 * outline, which is why the icon is not optional.
 */

/**
 * One row in a menu popup, in either menu the app has.
 *
 * `outline-none` is deliberate and is not an accessibility loss: Base UI moves
 * DOM focus onto the highlighted item, so the browser paints its focus ring on
 * top of an item that is already announcing itself with a wash of white. Two
 * indicators for one state, and the ring is the one that does not follow the
 * item's own rounding. `data-[highlighted]` covers the keyboard exactly as it
 * covers the pointer, which is what makes dropping the ring safe.
 */
export const menuItemClass =
  "flex w-full cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-neutral-300 select-none data-[highlighted]:bg-white/10 data-[highlighted]:text-neutral-100" +
  " outline-none";

/** A rule between sections. Never a fixed grey — see above. */
export function PanelRule({ className }: { className?: string }) {
  return <hr className={clsx("my-3 border-white/10", className)} />;
}

/**
 * A full-width action inside a panel.
 *
 * The icon leads and the label follows, both against the left edge. Centring
 * them looked deliberate in isolation and wrong in place: everything else in
 * these panels — the account, the captions, the menu items — starts at the
 * same left margin, and a centred row breaks the column the eye is already
 * following. The button is still full width, so the target is unchanged.
 *
 * The icon is not optional. With no border, a bare line of text in the middle
 * of a panel is indistinguishable from a caption until the pointer is over it,
 * and on a touch screen there is no such moment.
 */
export function PanelButton({
  icon,
  className,
  children,
  ...rest
}: {
  icon: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={clsx(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
        "text-neutral-300 transition-colors",
        "hover:bg-white/10 hover:text-neutral-50",
        "focus-visible:outline-2 focus-visible:outline-sky-500",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      <Icon name={icon} size={16} />
      {children}
    </button>
  );
}
