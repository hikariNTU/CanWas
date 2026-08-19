import type { AssetId } from "@/board/types";
import type { OcrRequest, OcrResponse } from "@/ocr/types";

/**
 * The main thread's half of the worker boundary: a queue of one.
 *
 * Jobs are sent one at a time and the next only leaves after the previous has
 * answered. The mock finishes in milliseconds and would not care, but a real
 * engine holds a model plus its intermediate tensors, and running several at
 * once multiplies that by the number in flight for no throughput — the worker
 * is one thread either way. Serialising here also makes "queued" and "running"
 * honest states rather than decoration.
 */

export interface OcrEvents {
  onRunning(assetId: AssetId): void;
  onProgress(assetId: AssetId, progress: number): void;
  onDone(
    assetId: AssetId,
    response: Extract<OcrResponse, { kind: "done" }>,
  ): void;
  onFailed(assetId: AssetId, error: string): void;
}

interface Job {
  assetId: AssetId;
  blob: Blob;
}

export class OcrClient {
  private worker: Worker | null = null;
  private readonly pending: Job[] = [];
  private active: AssetId | null = null;
  /** Every asset this client has accepted, so a repeat request is ignored. */
  private readonly seen = new Set<AssetId>();
  private events: OcrEvents | null = null;

  setEvents(events: OcrEvents | null) {
    this.events = events;
  }

  /** True if the asset was accepted; false if it was already queued or done. */
  enqueue(assetId: AssetId, blob: Blob): boolean {
    if (this.seen.has(assetId)) {
      return false;
    }
    this.seen.add(assetId);
    this.pending.push({ assetId, blob });
    void this.pump();
    return true;
  }

  /**
   * Forgets an asset so it can be recognized again. Used when a result is
   * discarded — a stored `failed` should be retryable, a stored `done` not.
   */
  forget(assetId: AssetId) {
    this.seen.delete(assetId);
  }

  /** Marks an asset as already answered, so a stored result is not recomputed. */
  adopt(assetId: AssetId) {
    this.seen.add(assetId);
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
        name: "canwas-ocr",
      });
      // Attached once, at creation: `??=` on the field would still have run
      // this line on every call and stacked a listener per job.
      this.worker.addEventListener("message", this.handleMessage);
    }
    return this.worker;
  }

  private readonly handleMessage = (event: MessageEvent<OcrResponse>) => {
    const message = event.data;
    if (message.assetId !== this.active) {
      // A response for something we are no longer tracking: the queue moved on
      // after a failure, or the client was reset. Dropping it is correct.
      return;
    }
    if (message.kind === "progress") {
      this.events?.onProgress(message.assetId, message.progress);
      return;
    }
    if (message.kind === "done") {
      this.events?.onDone(message.assetId, message);
    } else {
      this.events?.onFailed(message.assetId, message.error);
    }
    this.active = null;
    void this.pump();
  };

  private async pump(): Promise<void> {
    if (this.active !== null) {
      return;
    }
    const job = this.pending.shift();
    if (!job) {
      return;
    }
    this.active = job.assetId;
    this.events?.onRunning(job.assetId);
    try {
      const bitmap = await createImageBitmap(job.blob);
      const request: OcrRequest = {
        kind: "recognize",
        assetId: job.assetId,
        bitmap,
      };
      this.ensureWorker().postMessage(request, [bitmap]);
    } catch (error) {
      // Decoding failed on the main thread, so the worker never heard about it
      // and will never answer. Fail the job here or the queue stalls forever.
      this.events?.onFailed(
        job.assetId,
        error instanceof Error ? error.message : String(error),
      );
      this.active = null;
      void this.pump();
    }
  }
}

/**
 * One client for the whole app, and therefore one worker. Assets are shared
 * across boards, so a per-board client would recognize the same pixels twice.
 */
export const ocrClient = new OcrClient();
