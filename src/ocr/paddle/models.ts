import { getModel, putModel } from "@/storage/db";

/**
 * Where the weights come from, and how they get here once.
 *
 * The official PaddlePaddle repositories publish these graphs as ONNX under
 * Apache-2.0, served with `access-control-allow-origin: *`, so the app can
 * fetch them directly rather than shipping 31 MB of binaries in git. Third
 * party ONNX mirrors exist and are more convenient; they are also unverifiable,
 * and these are the same files without that question.
 *
 * The ids are versioned, so a device that already holds the old weights does
 * not read the wrong graph out of its cache — it downloads the new pair and the
 * old one is swept.
 */

const HUGGING_FACE = "https://huggingface.co";

export interface ModelSource {
  id: string;
  url: string;
  /** Rough size, used to weight the progress bar before headers arrive. */
  approximateBytes: number;
}

/**
 * PP-OCRv6, at the *small* size.
 *
 * The family comes in three, and the middle of them is the interesting one on
 * paper and unusable here: `medium` is 62 MB of detection and 77 MB of
 * recognition, and 138 MB is not a thing to make someone download to read a
 * screenshot. `tiny` is 6 MB all in — smaller than the v5 pair this replaces —
 * and is the fallback if 31 MB turns out to be too much.
 *
 * `small` costs 10 MB more than PP-OCRv5 mobile did and is a much larger model
 * than that name suggests.
 */
export const DETECTION_MODEL: ModelSource = {
  id: "ppocrv6-small-det",
  url: `${HUGGING_FACE}/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/main/inference.onnx`,
  approximateBytes: 9_880_512,
};

export const RECOGNITION_MODEL: ModelSource = {
  id: "ppocrv6-small-rec",
  url: `${HUGGING_FACE}/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/main/inference.onnx`,
  approximateBytes: 21_159_378,
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
