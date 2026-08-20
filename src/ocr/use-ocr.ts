import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";

import { assetsAtom } from "@/board/store";
import {
  assetIdsOf,
  type Asset,
  type BoardNode,
  type OcrState,
} from "@/board/types";
import { ocrClient } from "@/ocr/client";
import { putAsset } from "@/storage/db";

/** Only these survive a reload — see `applyOcr`. */
function isTerminal(ocr: OcrState): boolean {
  return ocr.status === "done" || ocr.status === "failed";
}

/**
 * Drives recognition for the images on the open board.
 *
 * Recognition is derived data, not content: it is never undoable (D17), never
 * bumps the board's `updatedAt`, and is stored on the Asset rather than the
 * Node (D13) so two nodes sharing a screenshot share one result and one job.
 */
export function useOcr(nodes: readonly BoardNode[]) {
  const assets = useAtomValue(assetsAtom);
  const setAssets = useSetAtom(assetsAtom);

  const applyOcr = useCallback(
    (assetId: string, ocr: OcrState) => {
      setAssets((previous) => {
        const asset = previous[assetId];
        if (!asset) {
          return previous;
        }
        const next: Asset = { ...asset, ocr };
        if (isTerminal(ocr)) {
          // Only terminal states reach disk. A stored "running" would outlive
          // the run that produced it: after a reload there is no job behind it
          // and no code path that ever resolves it, so the asset would sit at
          // a spinner forever. Writing is immediate rather than debounced —
          // unlike layout, a result costs real work to recompute.
          const { url: _url, ...record } = next;
          void putAsset(record);
        }
        return { ...previous, [assetId]: next };
      });
    },
    [setAssets],
  );

  useEffect(() => {
    ocrClient.setEvents({
      onRunning: (assetId) =>
        applyOcr(assetId, { status: "running", progress: 0 }),
      onProgress: (assetId, progress, phase) =>
        applyOcr(assetId, { status: "running", progress, phase }),
      onDone: (assetId, response) =>
        applyOcr(assetId, { status: "done", words: response.words }),
      onFailed: (assetId, error) =>
        applyOcr(assetId, { status: "failed", error }),
    });
    return () => ocrClient.setEvents(null);
  }, [applyOcr]);

  useEffect(() => {
    for (const assetId of new Set(assetIdsOf(nodes))) {
      const asset = assets[assetId];
      // `failed` is included so a reload retries: the failure may have been
      // the tab running out of memory, not the pixels.
      const status = asset?.ocr.status;
      if (!asset || (status !== "idle" && status !== "failed")) {
        continue;
      }
      // Asked before, and marked queued before: `enqueue` pumps synchronously,
      // so for the first job in an idle queue `onRunning` fires *inside* the
      // call. Marking queued afterwards would overwrite the running state with
      // a staler one, and nothing would correct it until the first progress
      // event — which, on a cold start, is behind a 31 MB download. The job
      // ran the whole time; only the label was wrong.
      //
      // The check also stops a stored `failed` from retrying in a loop: it is
      // retried once per session, on the reload that clears this memory.
      if (ocrClient.accepted(assetId)) {
        continue;
      }
      applyOcr(assetId, { status: "queued" });
      ocrClient.enqueue(assetId, asset.blob);
    }
  }, [applyOcr, assets, nodes]);

  useEffect(() => {
    for (const assetId of new Set(assetIdsOf(nodes))) {
      // A result restored from disk means the pixels have already been read.
      if (assets[assetId]?.ocr.status === "done") {
        ocrClient.adopt(assetId);
      }
    }
  }, [assets, nodes]);
}
