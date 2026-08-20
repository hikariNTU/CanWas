import * as ort from "onnxruntime-web/wasm";
// Vite emits the runtime's wasm binary as an asset and hands back its final
// URL, so it is served from this origin rather than fetched from a CDN.
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import type { OcrPhase, Word } from "@/board/types";
import { decodeLine, splitIntoWords } from "@/ocr/paddle/ctc";
import {
  boxesFromProbabilityMap,
  inReadingOrder,
  type Box,
  type DetectedBox,
} from "@/ocr/paddle/db-postprocess";
import {
  DETECTION_MODEL,
  loadModel,
  MODEL_BYTES,
  RECOGNITION_MODEL,
} from "@/ocr/paddle/models";
import {
  cropForRecognition,
  packBatch,
  prepareDetectionInput,
  RECOGNITION_HEIGHT,
  type Crop,
} from "@/ocr/paddle/preprocess";
import type { Recognizer, RecognizeOptions } from "@/ocr/types";

/**
 * PP-OCRv6 small, detection then recognition, on ONNX Runtime's WASM backend.
 *
 * Two graphs, run in sequence: DBNet finds where the text is and outputs one
 * probability channel; a CRNN with a CTC head reads each box it found. Neither
 * is asked to do the other's job, which is why the detection result can be
 * trusted for layout even when a line is read wrong.
 */

/**
 * One thread. Threads need `SharedArrayBuffer`, which needs cross-origin
 * isolation, which needs COOP/COEP response headers — and GitHub Pages does not
 * let anyone set headers. Asking for more would only make the runtime probe for
 * something that cannot be there.
 */
const THREADS = 1;
/** Lines per recognition run. PaddleOCR's own default is the same order. */
const BATCH_SIZE = 6;
/** Share of the progress bar spent fetching weights the first time. */
const DOWNLOAD_SHARE = 0.7;

ort.env.wasm.numThreads = THREADS;
ort.env.wasm.wasmPaths = { wasm: wasmUrl };

interface Sessions {
  detection: ort.InferenceSession;
  recognition: ort.InferenceSession;
}

export class PaddleRecognizer implements Recognizer {
  /**
   * Held as the promise, not the result, so that two images arriving together
   * wait on one download rather than starting two. Nothing else guards this —
   * the queue is one job deep (D39) — but the first `await` inside would still
   * be enough of a gap for a second caller to slip through.
   */
  private sessions: Promise<Sessions> | null = null;

  private async load(
    onProgress: (fraction: number, phase: OcrPhase) => void,
  ): Promise<Sessions> {
    let detectionBytes = 0;
    let recognitionBytes = 0;
    const report = () => {
      const loaded = detectionBytes + recognitionBytes;
      onProgress((loaded / MODEL_BYTES) * DOWNLOAD_SHARE, "download");
    };

    const [detectionModel, recognitionModel] = await Promise.all([
      loadModel(DETECTION_MODEL, (bytes) => {
        detectionBytes = bytes;
        report();
      }),
      loadModel(RECOGNITION_MODEL, (bytes) => {
        recognitionBytes = bytes;
        report();
      }),
    ]);

    const options: ort.InferenceSession.SessionOptions = {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    };
    const [detection, recognition] = await Promise.all([
      ort.InferenceSession.create(detectionModel, options),
      ort.InferenceSession.create(recognitionModel, options),
    ]);
    return { detection, recognition };
  }

  async recognize(
    bitmap: ImageBitmap,
    { signal, onProgress = () => {} }: RecognizeOptions = {},
  ): Promise<readonly Word[]> {
    this.sessions ??= this.load(onProgress);
    const { detection, recognition } = await this.sessions;
    signal?.throwIfAborted();
    onProgress(DOWNLOAD_SHARE, "read");

    const boxes = await this.detect(detection, bitmap);
    signal?.throwIfAborted();
    if (boxes.length === 0) {
      onProgress(1, "read");
      return [];
    }

    const words = await this.read(recognition, bitmap, boxes, (fraction) => {
      onProgress(DOWNLOAD_SHARE + (1 - DOWNLOAD_SHARE) * fraction, "read");
    });
    onProgress(1, "read");
    return words;
  }

  private async detect(
    session: ort.InferenceSession,
    bitmap: ImageBitmap,
  ): Promise<DetectedBox[]> {
    const input = prepareDetectionInput(bitmap);
    const tensor = new ort.Tensor("float32", input.data, [
      1,
      3,
      input.height,
      input.width,
    ]);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const map = outputs[session.outputNames[0]];
    const probabilities = map.data as Float32Array;
    // [N, 1, H, W] — the map is not necessarily the size that went in, so its
    // own dimensions are what the boxes are measured against.
    const height = Number(map.dims[2]);
    const width = Number(map.dims[3]);

    const found = boxesFromProbabilityMap(probabilities, width, height);
    // Detection ran on a resized canvas; the boxes have to come back to the
    // asset's own pixels, which is the only space a Word is ever expressed in.
    const toAsset = input.inverseScale * (input.width / width);
    const rescale = (box: Box): Box => ({
      x0: Math.max(0, box.x0 * toAsset),
      y0: Math.max(0, box.y0 * toAsset),
      x1: Math.min(bitmap.width, box.x1 * toAsset),
      y1: Math.min(bitmap.height, box.y1 * toAsset),
    });
    return inReadingOrder(
      found.map((box) => ({
        ...rescale(box),
        score: box.score,
        text: rescale(box.text),
      })),
    );
  }

  private async read(
    session: ort.InferenceSession,
    bitmap: ImageBitmap,
    boxes: readonly DetectedBox[],
    onProgress: (fraction: number) => void,
  ): Promise<Word[]> {
    const words: Word[] = [];

    for (let start = 0; start < boxes.length; start += BATCH_SIZE) {
      const slice = boxes.slice(start, start + BATCH_SIZE);
      const crops: Crop[] = slice.map((box) => cropForRecognition(bitmap, box));
      const batch = packBatch(crops);
      const tensor = new ort.Tensor("float32", batch.data, [
        crops.length,
        3,
        RECOGNITION_HEIGHT,
        batch.width,
      ]);
      const outputs = await session.run({ [session.inputNames[0]]: tensor });
      const logits = outputs[session.outputNames[0]];
      const data = logits.data as Float32Array;
      const timesteps = Number(logits.dims[1]);
      const classes = Number(logits.dims[2]);

      slice.forEach((box, index) => {
        const line = decodeLine(
          data,
          timesteps,
          classes,
          index * timesteps * classes,
        );
        const decoded = splitIntoWords(line).filter(
          (word) => word.text.trim() !== "",
        );
        if (decoded.length === 0) {
          return;
        }

        // The CTC timesteps run across the padded batch width, while this line
        // only occupies the part its own crop filled — so a fraction along the
        // batch has to be rescaled by that share before it means anything in
        // the box it came from.
        const share = batch.width / crops[index].width;
        const boxWidth = box.x1 - box.x0;
        const at = (fraction: number) =>
          box.x0 + Math.min(1, fraction * share) * boxWidth;

        const spans = decoded.map((word) => ({
          word,
          x0: at(word.start),
          x1: at(word.end),
        }));

        // Tile the words across the line rather than trusting each peak's own
        // extent. A CTC head marks a character in the one slice it fires in,
        // which sits late and covers less than the glyph does: measured, words
        // came out about 30% narrower than their ink and drifted left. Meeting
        // each neighbour halfway restores the line, and matches what selecting
        // text looks like anyway — the highlight covers the spaces too.
        for (let i = 0; i < spans.length; i++) {
          const previous = spans[i - 1];
          const next = spans[i + 1];
          const left =
            previous === undefined
              ? box.text.x0
              : (previous.x1 + spans[i].x0) / 2;
          const right =
            next === undefined ? box.text.x1 : (spans[i].x1 + next.x0) / 2;
          words.push({
            text: spans[i].word.text,
            x0: left,
            x1: Math.max(left + 1, right),
            // The tight box, not the expanded one that was cropped and read:
            // the expansion exists to keep ascenders out of the crop's edge,
            // and reporting it would sit the highlight 8px proud of the ink.
            y0: box.text.y0,
            y1: box.text.y1,
            confidence: spans[i].word.confidence * box.score,
          });
        }
      });
      onProgress(Math.min(1, (start + slice.length) / boxes.length));
    }

    return words;
  }
}
