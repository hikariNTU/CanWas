import clsx from "clsx";

import { Icon } from "@/ui/icon";
import { useTranslation, type TranslationsKey } from "@/translations";
import type { OcrState } from "@/board/types";

const PRESENTATION: Record<
  OcrState["status"],
  { icon: string; label: TranslationsKey; className: string } | null
> = {
  // Idle and done are silent. Idle is a job about to start and would flash for
  // one frame; done is announced by the overlay becoming selectable, and a
  // badge on every finished image would be permanent clutter on a full board.
  idle: null,
  done: null,
  // `document_scanner` rather than an hourglass: a queue is only interesting
  // because of what is at the end of it, and this glyph says "text is going to
  // be read out of this" where an hourglass only says "wait". There is no `ocr`
  // glyph — the name renders as the literal word.
  queued: {
    icon: "document_scanner",
    label: "ocr.queued",
    className: "text-neutral-400",
  },
  // The font's own spinner, meant to rotate. `autorenew` is the refresh arrows
  // and reads as "retrying" when nothing has gone wrong.
  running: {
    icon: "progress_activity",
    label: "ocr.running",
    className: "text-neutral-400",
  },
  failed: { icon: "error", label: "ocr.failed", className: "text-amber-400" },
};

/**
 * Recognition status for one image.
 *
 * An icon at rest, a sentence when asked. A board of screenshots is a board of
 * these, and a row of captions on every image competes with the images for the
 * one thing the app is for — so the word appears on hover, and while the node
 * is selected, which is the touch answer to the same question.
 *
 * Sits inside the scaled scene but counter-scales itself, so it stays legible
 * at 10% zoom and does not swell into a banner at 800% — status is chrome, and
 * chrome belongs to the screen rather than to the world. The inset is inside
 * the counter-scale for the same reason: written as a plain offset it would be
 * measured in world units and collapse against the image edge when zoomed out.
 *
 * Which is also why it disappears on a thumbnail. A fixed-size badge on a node
 * zoomed down to a stamp is larger than the thing it describes and hangs off
 * its edges — and at that size the image is unreadable anyway, so the status
 * of reading it is not the question being asked.
 */

/** Screen px the node must span in both axes before the badge is worth it. */
const MIN_NODE_SIZE = 48;
export function OcrBadge({
  ocr,
  scale,
  width,
  height,
  expanded = false,
}: {
  ocr: OcrState;
  scale: number;
  /** The node's size in world units, as the badge only knows its own. */
  width: number;
  height: number;
  /** Show the label unprompted — the node is selected. */
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const presentation = PRESENTATION[ocr.status];
  if (
    !presentation ||
    width * scale < MIN_NODE_SIZE ||
    height * scale < MIN_NODE_SIZE
  ) {
    return null;
  }
  const downloading = ocr.status === "running" && ocr.phase === "download";
  const progress = ocr.status === "running" ? ocr.progress : undefined;
  // The first image on a fresh browser spends most of its wait fetching 21 MB
  // of weights. Saying so is the difference between a slow app and a stuck one.
  const label: TranslationsKey = downloading
    ? "ocr.downloading"
    : presentation.label;
  const percent =
    progress === undefined ? "" : ` ${Math.round(progress * 100)}%`;

  return (
    <div
      data-testid="ocr-badge"
      data-ocr-status={ocr.status}
      // `glass-strong`, unlike every other control: this is the one widget
      // that floats over unknown pixels rather than over the canvas. At the
      // thin tint a screenshot of a white page shows through and turns the
      // chip into a pale smudge with an unreadable glyph on it.
      //
      // Kept as a title as well: the label is hidden at rest, and the pointer
      // is already there.
      title={`${t(label)}${percent}`}
      className="glass-strong pointer-events-none absolute bottom-0 left-0 flex origin-bottom-left items-center gap-1.5 rounded-md px-2 py-1"
      // Scale first, then step in: the translation is applied in the badge's
      // own space, so the 8px survives the counter-scale as 8 screen px.
      style={{ transform: `scale(${1 / scale}) translate(8px, -8px)` }}
    >
      <Icon
        name={downloading ? "cloud_download" : presentation.icon}
        size={14}
        className={clsx(
          presentation.className,
          // The one motion in the app that is not decoration: a long download
          // can sit at the same percentage for seconds, and this is what says
          // the tab is still working rather than wedged.
          ocr.status === "running" && !downloading && "animate-spin",
        )}
      />
      <span
        className={clsx(
          "text-xs leading-none whitespace-nowrap text-neutral-400",
          expanded ? "inline" : "hidden group-hover:inline",
        )}
      >
        {t(label)}
        {percent}
      </span>
    </div>
  );
}
