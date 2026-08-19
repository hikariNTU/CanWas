import type { Asset } from "@/board/types";
import type { Point, Viewport } from "@/canvas/coords";

/**
 * A pasted image is scaled to occupy at most this fraction of the visible
 * canvas, and is never enlarged (D19).
 */
const VIEWPORT_FIT_FRACTION = 0.4;

/** Cascade offset in world units, so stacked placements stay distinguishable. */
const CASCADE_STEP = 24;

export async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function readIntrinsicSize(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/**
 * World size for a newly placed image: at most VIEWPORT_FIT_FRACTION of the
 * visible canvas in each axis, and never larger than intrinsic size — a 32x32
 * favicon must not be blown up to fill the screen.
 */
export function fitSize(
  asset: Pick<Asset, "width" | "height">,
  viewport: Viewport,
  surface: { width: number; height: number },
): { w: number; h: number } {
  const visibleWorldWidth = surface.width / viewport.scale;
  const visibleWorldHeight = surface.height / viewport.scale;
  const factor = Math.min(
    1,
    (visibleWorldWidth * VIEWPORT_FIT_FRACTION) / asset.width,
    (visibleWorldHeight * VIEWPORT_FIT_FRACTION) / asset.height,
  );
  return { w: asset.width * factor, h: asset.height * factor };
}

/** Top-left corner that centres a `w × h` box on `centre`. */
export function placeCentred(
  centre: Point,
  size: { w: number; h: number },
): Point {
  return { x: centre.x - size.w / 2, y: centre.y - size.h / 2 };
}

/**
 * Nudges `origin` diagonally until it does not land on top of an existing node.
 *
 * Cascading by index within a single drop is not enough: pasting the same image
 * twice is two separate ingests, each starting from index 0, so the second copy
 * would sit exactly under the first and look like nothing happened.
 */
export function cascadeFreeOrigin(
  taken: readonly Point[],
  origin: Point,
): Point {
  const isTaken = (candidate: Point) =>
    taken.some(
      (point) =>
        Math.abs(point.x - candidate.x) < CASCADE_STEP / 2 &&
        Math.abs(point.y - candidate.y) < CASCADE_STEP / 2,
    );

  const candidate = { ...origin };
  // Bounded so a pathological board cannot spin here.
  for (let step = 0; step < 500 && isTaken(candidate); step++) {
    candidate.x += CASCADE_STEP;
    candidate.y += CASCADE_STEP;
  }
  return candidate;
}

/** Images only. A clipboard carrying text alongside an image is still an image. */
export function imageFilesFrom(
  transfer: DataTransfer | null | undefined,
): File[] {
  if (!transfer) {
    return [];
  }
  return Array.from(transfer.files).filter((file) =>
    file.type.startsWith("image/"),
  );
}
