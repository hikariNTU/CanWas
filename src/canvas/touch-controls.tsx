import clsx from "clsx";
import type { ReactNode } from "react";

import type { CanvasMode } from "@/canvas/canvas-mode";
import { Icon } from "@/ui/icon";
import { useTranslation } from "@/translations";

/**
 * The touch-only bar: mode, add, delete — everything one finger needs and a
 * mouse already has elsewhere (D70).
 *
 * One bar rather than a chip plus a corner button plus a floating selection
 * strip. Three surfaces competing for the bottom of a 412px screen is how the
 * chip ended up on top of the undo island in the first place, and a thumb that
 * has found this bar should not have to leave it to add a picture or throw one
 * away.
 *
 * Nothing here renders on a fine pointer. A mouse has the space bar, the
 * middle button and the Delete key, and it keeps the add button in its corner.
 */
export function TouchBar({
  mode,
  onChange,
  hasSelection,
  onDelete,
  addImage,
}: {
  mode: CanvasMode;
  onChange: (next: CanvasMode) => void;
  hasSelection: boolean;
  onDelete: () => void;
  /** The file picker, passed in rather than rebuilt: one input, one owner. */
  addImage: ReactNode;
}) {
  const { t } = useTranslation();
  const options: { mode: CanvasMode; icon: string; label: string }[] = [
    { mode: "pan", icon: "pan_tool", label: t("canvas.modePan") },
    { mode: "select", icon: "highlight_alt", label: t("canvas.modeSelect") },
  ];

  return (
    <div
      data-testid="touch-bar"
      // Fully rounded, unlike the square-cornered islands: this is a switch
      // with tools attached rather than a group of equal buttons, and the pill
      // says so before the icons do.
      className="glass pointer-events-auto flex items-center gap-1 rounded-full p-1"
    >
      {options.map((option) => (
        <button
          key={option.mode}
          type="button"
          data-testid={`mode-${option.mode}`}
          aria-label={option.label}
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
          className={clsx(
            // 44x44, the minimum touch target Apple's HIG asks for, and
            // square so the pill reads as a row of circles rather than a row
            // of lozenges. No text: a hand and a marquee are the two most
            // drawn icons in this category of app, and a label in two
            // languages costs more width than it explains.
            "grid h-11 w-11 place-items-center rounded-full transition-colors duration-150",
            // White at a low alpha, never a fixed grey. Inside glass the
            // surface is tinted and the board moves behind it, so a flat
            // neutral is the one thing in the bar that does not move with it
            // and it reads as a seam (docs/ui-guidelines.md).
            mode === option.mode
              ? "bg-white/10 text-sky-400"
              : "text-neutral-400",
          )}
        >
          <Icon name={option.icon} size={22} />
        </button>
      ))}

      {/* No margin of its own: the row's `gap-1` spaces it, so the distance
          from the marquee to the rule is the same as from the rule to the add
          button, and the same as between the two modes. A divider with its own
          margins made the add button sit visibly further out than the
          segments were from each other. */}
      <span aria-hidden className="h-6 w-px bg-white/10" />

      {addImage}

      {/* Last, and conditional: a control that comes and goes must never shift
          the position of the permanent ones — the same rule the desktop
          bottom-left row follows. */}
      {hasSelection && (
        <button
          type="button"
          data-testid="delete-selection"
          aria-label={t("canvas.deleteSelection")}
          onClick={onDelete}
          className="grid h-11 w-11 place-items-center rounded-full text-neutral-400 transition-colors duration-150 active:bg-white/10 active:text-red-400"
        >
          <Icon name="delete" size={22} />
        </button>
      )}
    </div>
  );
}
