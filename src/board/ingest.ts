import type { Asset } from "@/board/types";
import type { Point } from "@/canvas/coords";

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
 * World size for a newly placed image: the size it was, and nothing else
 * (D59).
 *
 * Not fitted to the viewport. A paste that resized itself to the window meant
 * the same screenshot came out a different size depending on the zoom it
 * happened to be pasted at, and two captures of the same screen at different
 * crops came out the same size as each other — which destroys the one
 * comparison a board of screenshots exists to make.
 *
 * `density` is the file's own idea of how many pixels it spends per CSS pixel,
 * so a retina capture lands at the size it appeared on screen rather than at
 * double it. See `density.ts`.
 */
export function naturalSize(
  asset: Pick<Asset, "width" | "height">,
  density = 1,
): { w: number; h: number } {
  return { w: asset.width / density, h: asset.height / density };
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
