/// <reference lib="webworker" />

import { MockRecognizer } from "@/ocr/mock-recognizer";
import type { OcrRequest, OcrResponse, Recognizer } from "@/ocr/types";

/**
 * The dedicated OCR worker. `ImageBitmap` transfers in zero-copy, so a large
 * screenshot costs a pointer rather than a copy.
 *
 * This module is the only place that names a concrete recognizer. Swapping
 * `MockRecognizer` for `PaddleRecognizer` is a one-line change here and is
 * invisible to every caller — the main thread never learns which engine
 * answered.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: OcrResponse) {
  scope.postMessage(message);
}

scope.addEventListener("message", (event: MessageEvent<OcrRequest>) => {
  const request = event.data;
  if (request.kind !== "recognize") {
    return;
  }
  const { assetId, bitmap } = request;
  // Seeded by the asset id, which is the content hash: the same bytes always
  // produce the same fake reading, so a reload does not reshuffle the overlay.
  const recognizer: Recognizer = new MockRecognizer(assetId);

  void (async () => {
    try {
      const words = await recognizer.recognize(bitmap, {
        onProgress: (progress) => post({ kind: "progress", assetId, progress }),
      });
      post({ kind: "done", assetId, words: [...words] });
    } catch (error) {
      post({
        kind: "failed",
        assetId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // The bitmap belongs to the worker once transferred, and an unclosed one
      // holds its full decoded size until GC gets around to it.
      bitmap.close();
    }
  })();
});
