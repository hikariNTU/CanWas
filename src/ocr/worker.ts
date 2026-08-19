/// <reference lib="webworker" />

import { MockRecognizer } from "@/ocr/mock-recognizer";
import type { PaddleRecognizer } from "@/ocr/paddle/paddle-recognizer";
import type {
  EngineName,
  OcrRequest,
  OcrResponse,
  Recognizer,
} from "@/ocr/types";

/**
 * The dedicated OCR worker. `ImageBitmap` transfers in zero-copy, so a large
 * screenshot costs a pointer rather than a copy.
 *
 * This module is the only place that names a concrete recognizer, which is
 * what made adding a real engine a change to one file: everything upstream
 * still knows nothing but the `Recognizer` interface.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * The real engine is kept alive between jobs; the mock is not worth keeping.
 *
 * A `PaddleRecognizer` holds two ONNX sessions and 21 MB of weights, so
 * building a new one per image would re-download and re-compile them every
 * time. `MockRecognizer` is seeded per asset by design and holds nothing.
 *
 * Imported dynamically, and therefore split into its own chunk, so that the
 * 190 KB of ONNX Runtime it pulls in is fetched only once something has asked
 * to be read for real. The worker itself already costs nothing until the first
 * image arrives, and this keeps that true for a board of nothing but text.
 */
let paddle: Promise<PaddleRecognizer> | null = null;

function recognizerFor(
  engine: EngineName,
  assetId: string,
): Recognizer | Promise<Recognizer> {
  if (engine === "mock") {
    // Seeded by the asset id, which is the content hash: the same bytes always
    // produce the same fake reading, so a reload does not reshuffle it.
    return new MockRecognizer(assetId);
  }
  // Held as the promise so two jobs in flight share one import and one set of
  // sessions rather than racing to build a second.
  paddle ??= import("@/ocr/paddle/paddle-recognizer").then(
    (module) => new module.PaddleRecognizer(),
  );
  return paddle;
}

function post(message: OcrResponse) {
  scope.postMessage(message);
}

scope.addEventListener("message", (event: MessageEvent<OcrRequest>) => {
  const request = event.data;
  if (request.kind !== "recognize") {
    return;
  }
  const { assetId, bitmap, engine } = request;
  const pending = recognizerFor(engine, assetId);

  void (async () => {
    try {
      const recognizer = await pending;
      const words = await recognizer.recognize(bitmap, {
        onProgress: (progress, phase) =>
          post({ kind: "progress", assetId, progress, phase }),
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
