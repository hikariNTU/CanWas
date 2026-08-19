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
  queued: {
    icon: "hourglass_empty",
    label: "ocr.queued",
    className: "text-neutral-400",
  },
  running: {
    icon: "autorenew",
    label: "ocr.running",
    className: "text-sky-400",
  },
  failed: { icon: "error", label: "ocr.failed", className: "text-amber-400" },
};

/**
 * Recognition status for one image.
 *
 * Sits inside the scaled scene but counter-scales itself, so it stays legible
 * at 10% zoom and does not swell into a banner at 800% — status is chrome, and
 * chrome belongs to the screen rather than to the world.
 */
export function OcrBadge({ ocr, scale }: { ocr: OcrState; scale: number }) {
  const { t } = useTranslation();
  const presentation = PRESENTATION[ocr.status];
  if (!presentation) {
    return null;
  }
  const progress = ocr.status === "running" ? ocr.progress : undefined;
  // The first image on a fresh browser spends most of its wait fetching 21 MB
  // of weights. Saying so is the difference between a slow app and a stuck one.
  const label: TranslationsKey =
    ocr.status === "running" && ocr.phase === "download"
      ? "ocr.downloading"
      : presentation.label;
  return (
    <div
      data-testid="ocr-badge"
      data-ocr-status={ocr.status}
      title={t(label)}
      className="pointer-events-none absolute bottom-0 left-0 flex origin-bottom-left items-center gap-1 bg-neutral-950/80 px-1.5 py-1"
      style={{ transform: `scale(${1 / scale})` }}
    >
      <Icon
        name={
          ocr.status === "running" && ocr.phase === "download"
            ? "cloud_download"
            : presentation.icon
        }
        size={14}
        className={
          ocr.status === "running"
            ? `${presentation.className} animate-spin`
            : presentation.className
        }
      />
      <span className="text-[11px] leading-none text-neutral-300">
        {t(label)}
        {progress === undefined ? "" : ` ${Math.round(progress * 100)}%`}
      </span>
    </div>
  );
}
