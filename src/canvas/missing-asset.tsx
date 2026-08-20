import { Icon } from "@/ui/icon";
import { useTranslation } from "@/translations";

/**
 * An image node whose bytes are not on this device.
 *
 * The ordinary reason is sync: a board arrives from another device before its
 * images do, or the images are still uploading from wherever they were pasted.
 * The node's geometry travelled in the board JSON, so its size and position are
 * known exactly — it is only the pixels that are missing.
 *
 * Which is why this is a placeholder rather than nothing. Rendering nothing
 * left a node that could be selected, dragged and deleted while being
 * completely invisible, and the honest reading of an empty rectangle is that
 * the board is broken. A frame that says "this is a picture, and it is not here
 * yet" is a state; a hole is a bug report.
 *
 * It is deliberately not an error. Nothing has been lost — the next round from
 * the device that holds the bytes fills it in.
 */
export function MissingAsset({ scale }: { scale: number }) {
  const { t } = useTranslation();
  // Big enough to read, but never bigger than the frame it is explaining.
  const glyph = Math.min(48, 48 / scale);
  return (
    <div
      data-testid="missing-asset"
      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-700 bg-neutral-900/60 text-neutral-500"
      title={t("asset.missing")}
    >
      <Icon name="hide_image" size={glyph} />
    </div>
  );
}
