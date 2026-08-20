/// <reference lib="webworker" />

import type { CompressRequest, CompressResponse } from "@/image/types";

/**
 * Re-encodes an image to WebP, off the main thread.
 *
 * Its own worker rather than a job on the OCR one: that queue is deliberately
 * one deep and its first job can spend a minute fetching 31 MB of weights.
 * Compression is seconds of work at most and nothing waits on it, so putting it
 * behind that queue would mean the first image on a fresh browser stays
 * uncompressed until the model finishes downloading.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Dimensions are never touched. The point is to spend fewer bytes on the same
 * picture, not to hand the user a smaller one — a screenshot that has been
 * quietly downscaled is a screenshot whose text cannot be read back.
 */
async function toWebp(blob: Blob, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("OffscreenCanvas 2d context unavailable");
    }
    context.drawImage(bitmap, 0, 0);
    const encoded = await canvas.convertToBlob({
      type: "image/webp",
      quality,
    });
    // `convertToBlob` falls back to PNG rather than failing when it cannot
    // encode the type asked for, so the result has to be checked rather than
    // trusted. A PNG here would be a second copy of what we already have.
    if (encoded.type !== "image/webp") {
      throw new Error(`encoder returned ${encoded.type}`);
    }
    return encoded;
  } finally {
    bitmap.close();
  }
}

scope.addEventListener("message", (event: MessageEvent<CompressRequest>) => {
  const { assetId, blob, quality } = event.data;
  void toWebp(blob, quality).then(
    (webp) => {
      const response: CompressResponse = {
        kind: "done",
        assetId,
        webp,
        originalBytes: blob.size,
      };
      scope.postMessage(response);
    },
    (error: unknown) => {
      const response: CompressResponse = {
        kind: "failed",
        assetId,
        error: error instanceof Error ? error.message : String(error),
      };
      scope.postMessage(response);
    },
  );
});
