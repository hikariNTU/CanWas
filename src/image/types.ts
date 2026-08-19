import type { AssetId } from "@/board/types";

/**
 * WebP quality.
 *
 * Measured on a 900x210 dark-theme UI screenshot at 13px, read back with the
 * real recognizer:
 *
 * ```
 * png        29,364 B   read 18/20
 * webp@0.7    8,188 B   read 19/20
 * webp@0.8    9,528 B   read 19/20
 * webp@0.9   12,278 B   read 19/20
 * webp@0.95  14,720 B   read 19/20
 * webp@1     37,924 B   read 18/20
 * ```
 *
 * Two things came out of that. Recognition does not care: every WebP variant
 * read the same, and slightly better than the PNG. And quality 1 is a trap —
 * lossy WebP at maximum quality is *larger* than lossless PNG on flat UI
 * colour, so the one setting that sounds safest is the one that costs bytes for
 * nothing.
 *
 * So the choice is not about accuracy, which is flat, but about how the image
 * looks on a device that only ever received the WebP. 0.9 is 2.4x smaller than
 * the PNG with no visible artifacts; 0.7 would be 3.6x and starts to show.
 */
export const WEBP_QUALITY = 0.9;

/** Below this there is nothing to win, and a re-encode can come out larger. */
export const MIN_COMPRESSIBLE_BYTES = 24 * 1024;

/**
 * Images already in the sync format are left alone.
 *
 * Re-encoding lossy to lossy compounds artifacts for a second time, and the
 * bytes are already in the format sync wants. Measured, a WebP saved at quality
 * 1 does shrink by 68% when re-encoded at 0.9 — worth having, and not worth
 * generation loss on every WebP anyone ever pastes.
 */
export function shouldCompress(blob: Blob): boolean {
  return blob.size >= MIN_COMPRESSIBLE_BYTES && blob.type !== "image/webp";
}

export interface CompressRequest {
  assetId: AssetId;
  blob: Blob;
  quality: number;
}

export type CompressResponse =
  | {
      kind: "done";
      assetId: AssetId;
      webp: Blob;
      originalBytes: number;
    }
  | { kind: "failed"; assetId: AssetId; error: string };
