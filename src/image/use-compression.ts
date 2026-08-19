import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

import { assetsAtom } from "@/board/store";
import { assetIdsOf, type Asset, type BoardNode } from "@/board/types";
import {
  shouldCompress,
  WEBP_QUALITY,
  type CompressRequest,
  type CompressResponse,
} from "@/image/types";
import { putAsset } from "@/storage/db";

/**
 * Re-encodes the board's images to WebP in the background.
 *
 * The original is kept and is what stays on screen. Nothing waits for this:
 * the node renders from the bytes that arrived, and the WebP appears beside
 * them whenever it is ready. If it never is — an old browser, an encoder that
 * refuses — the app is exactly as it was.
 */
export function useCompression(nodes: readonly BoardNode[]) {
  const assets = useAtomValue(assetsAtom);
  const setAssets = useSetAtom(assetsAtom);
  const workerRef = useRef<Worker | null>(null);
  /** Assets already handed to the worker, so a re-render does not resend them. */
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "canwas-image",
    });
    workerRef.current = worker;

    function handleMessage(event: MessageEvent<CompressResponse>) {
      const message = event.data;
      if (message.kind === "failed") {
        // Nothing to recover and nothing to tell the user: the original is
        // still there and still correct. It stays uncompressed, and the info
        // panel is where that becomes visible.
        return;
      }
      // A re-encode that came out larger is not a saving, and keeping it would
      // cost storage locally to spend more bytes on sync.
      if (message.webp.size >= message.originalBytes) {
        return;
      }
      setAssets((previous) => {
        const asset = previous[message.assetId];
        if (!asset || asset.webp) {
          return previous;
        }
        const next: Asset = { ...asset, webp: message.webp };
        const { url: _url, ...record } = next;
        void putAsset(record);
        return { ...previous, [message.assetId]: next };
      });
    }

    worker.addEventListener("message", handleMessage);
    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, [setAssets]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) {
      return;
    }
    for (const assetId of new Set(assetIdsOf(nodes))) {
      const asset = assets[assetId];
      if (!asset || asset.webp || seenRef.current.has(assetId)) {
        continue;
      }
      if (!shouldCompress(asset.blob)) {
        continue;
      }
      seenRef.current.add(assetId);
      const request: CompressRequest = {
        assetId,
        blob: asset.blob,
        quality: WEBP_QUALITY,
      };
      worker.postMessage(request);
    }
  }, [assets, nodes]);
}
