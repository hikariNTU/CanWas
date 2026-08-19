import type { AssetId, Word } from "@/board/types";

/**
 * The seam OCR sits behind (docs/domain-model.md). The rest of the app knows
 * this interface and nothing else — not which engine answered, not whether one
 * exists yet.
 *
 * `MockRecognizer` ships first so the selection overlay can be built and proven
 * before a real engine lands; `PaddleRecognizer` replaces it without any caller
 * changing. Nothing outside `src/ocr/` may import an implementation directly.
 */
export interface Recognizer {
  recognize(
    bitmap: ImageBitmap,
    options?: RecognizeOptions,
  ): Promise<readonly Word[]>;
}

export interface RecognizeOptions {
  signal?: AbortSignal;
  /** 0..1. Called on the worker side; forwarded to the main thread as progress. */
  onProgress?: (progress: number) => void;
}

/**
 * Worker protocol. Keyed by AssetId, not NodeId: recognition belongs to the
 * pixels (D13), so two nodes sharing an asset are one job, and a node deleted
 * mid-run does not orphan a result.
 */
export type OcrRequest = {
  kind: "recognize";
  assetId: AssetId;
  bitmap: ImageBitmap;
};

export type OcrResponse =
  | { kind: "progress"; assetId: AssetId; progress: number }
  | { kind: "done"; assetId: AssetId; words: Word[] }
  | { kind: "failed"; assetId: AssetId; error: string };
