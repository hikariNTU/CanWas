import { getModel, putModel } from "@/storage/db";

/**
 * Where the weights come from, and how they get here once.
 *
 * The official PaddlePaddle repositories publish these graphs as ONNX under
 * Apache-2.0, served with `access-control-allow-origin: *`, so the app can
 * fetch them directly rather than shipping 21 MB of binaries in git. Third
 * party ONNX mirrors of PP-OCRv5 exist and are more convenient; they are also
 * unverifiable, and these are the same files without that question.
 */

const HUGGING_FACE = "https://huggingface.co";

export interface ModelSource {
  id: string;
  url: string;
  /** Rough size, used to weight the progress bar before headers arrive. */
  approximateBytes: number;
}

export const DETECTION_MODEL: ModelSource = {
  id: "ppocrv5-mobile-det",
  url: `${HUGGING_FACE}/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx`,
  approximateBytes: 4_826_518,
};

export const RECOGNITION_MODEL: ModelSource = {
  id: "ppocrv5-mobile-rec",
  url: `${HUGGING_FACE}/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx`,
  approximateBytes: 16_534_782,
};

export const MODEL_BYTES =
  DETECTION_MODEL.approximateBytes + RECOGNITION_MODEL.approximateBytes;

export type ProgressReporter = (loadedBytes: number) => void;

/**
 * Fetches a model, reporting bytes as they arrive, and caches it.
 *
 * The progress is read off the response body rather than estimated, because
 * this is the one part of the app where the user is waiting on the network and
 * a bar that does not move is indistinguishable from a hang.
 */
async function download(
  source: ModelSource,
  onProgress: ProgressReporter,
): Promise<{ bytes: ArrayBuffer; etag: string }> {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`${response.status} fetching ${source.id}`);
  }
  const etag = response.headers.get("etag") ?? "";
  const total = Number(response.headers.get("content-length")) || 0;
  const body = response.body;
  if (!body) {
    // No streaming available: still correct, just one jump at the end.
    const bytes = await response.arrayBuffer();
    onProgress(bytes.byteLength);
    return { bytes, etag };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
    onProgress(received);
  }

  const bytes = new Uint8Array(total || received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: bytes.buffer, etag };
}

/** A cached model if there is one, otherwise a download that becomes one. */
export async function loadModel(
  source: ModelSource,
  onProgress: ProgressReporter,
): Promise<ArrayBuffer> {
  const cached = await getModel(source.id).catch(() => undefined);
  if (cached) {
    onProgress(cached.bytes.byteLength);
    return cached.bytes;
  }

  const { bytes, etag } = await download(source, onProgress);
  // Cached after the fact and without blocking on it: a failed write costs one
  // repeat download, which is not worth failing recognition over.
  void putModel({
    id: source.id,
    bytes,
    etag,
    fetchedAt: Date.now(),
  }).catch(() => undefined);
  return bytes;
}
