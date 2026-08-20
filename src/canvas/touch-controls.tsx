import clsx from "clsx";

import type { CanvasMode } from "@/canvas/canvas-mode";
import { Icon } from "@/ui/icon";
import { useTranslation } from "@/translations";

/**
 * The touch-only chrome: the mode chip, and the selection bar that rises above
 * it. Both live at the bottom centre — the last free edge, and the half of the
 * screen a thumb reaches without regripping the phone.
 *
 * Neither renders on a fine pointer (D70). A mouse already has the modifiers
 * the chip stands in for, and a keyboard already has Delete.
 */
export function ModeChip({
  mode,
  onChange,
}: {
  mode: CanvasMode;
  onChange: (next: CanvasMode) => void;
}) {
  const { t } = useTranslation();
  const options: { mode: CanvasMode; icon: string; label: string }[] = [
    { mode: "pan", icon: "pan_tool", label: t("canvas.modePan") },
    { mode: "select", icon: "highlight_alt", label: t("canvas.modeSelect") },
  ];

  return (
    <div
      data-testid="mode-chip"
      // Fully rounded, unlike every other island: this is the one control that
      // is a switch rather than a group of buttons, and the pill shape says so
      // before the icons do.
      className="glass pointer-events-auto flex items-center gap-0.5 rounded-full p-1"
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
            // 44px, not the 32px the desktop islands use: a finger cannot
            // reliably hit anything smaller, and this is the control that
            // exists specifically because there is no pointer.
            "flex h-11 items-center gap-1.5 rounded-full px-4 text-xs transition-colors duration-150",
            mode === option.mode
              ? "bg-neutral-800 text-sky-400"
              : "text-neutral-400",
          )}
        >
          <Icon name={option.icon} />
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SelectionBar({
  count,
  onDelete,
}: {
  count: number;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="selection-bar"
      className="glass pointer-events-auto flex items-center gap-1 rounded-full p-1 pl-4"
    >
      {/* A bare number, not a sentence. "2 selected" would have to be built by
          concatenation, which the translation table forbids — and the count is
          the only part that changes anyway. */}
      <span className="font-mono text-xs text-neutral-300 tabular-nums">
        {count}
      </span>
      <button
        type="button"
        data-testid="delete-selection"
        aria-label={t("canvas.deleteSelection")}
        onClick={onDelete}
        className="grid h-11 w-11 place-items-center rounded-full text-neutral-400 transition-colors duration-150 active:bg-neutral-800 active:text-red-400"
      >
        <Icon name="delete" />
      </button>
    </div>
  );
}
