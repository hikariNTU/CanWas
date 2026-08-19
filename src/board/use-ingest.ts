import { useAtom } from "jotai";
import { useCallback, useEffect, type RefObject } from "react";

import {
  cascadeFreeOrigin,
  fitSize,
  hashBlob,
  imageFilesFrom,
  placeCentred,
  readIntrinsicSize,
} from "@/board/ingest";
import { useBoardHistory } from "@/board/history";
import { insertNodes } from "@/board/mutations";
import { assetsAtom } from "@/board/store";
import type { Asset, BoardNode } from "@/board/types";
import { screenToWorld, type Point, type Viewport } from "@/canvas/coords";

interface IngestOptions {
  boardId: string;
  viewport: Viewport;
  surfaceRef: RefObject<HTMLElement | null>;
  nodes: readonly BoardNode[];
}

/**
 * Turns pasted and dropped image files into Assets and Nodes.
 *
 * Reads `event.clipboardData.files` and never `navigator.clipboard.read()`
 * (D21): the async Clipboard API cannot be driven by a synthetic event, which
 * would make the paste path impossible to cover in Playwright.
 */
export function useIngest({
  boardId,
  viewport,
  surfaceRef,
  nodes,
}: IngestOptions) {
  const [assets, setAssets] = useAtom(assetsAtom);
  const { commit } = useBoardHistory(boardId);

  const ingestFiles = useCallback(
    async (files: File[], screenPoint: Point | null) => {
      const surface = surfaceRef.current;
      if (files.length === 0 || !surface) {
        return;
      }
      const rect = surface.getBoundingClientRect();
      const anchor: Point = screenPoint ?? {
        x: rect.width / 2,
        y: rect.height / 2,
      };
      const centre = screenToWorld(anchor, viewport);

      const newAssets: Asset[] = [];
      const pending: { asset: Asset; size: { w: number; h: number } }[] = [];

      for (const file of files) {
        const hash = await hashBlob(file);
        // Content addressing: the same bytes never occupy two Assets, so a
        // duplicate paste reuses the existing recognition result too.
        const existing =
          assets[hash] ?? newAssets.find((asset) => asset.hash === hash);
        const asset =
          existing ??
          ({
            id: hash,
            blob: file,
            ...(await readIntrinsicSize(file)),
            hash,
            ocr: { status: "idle" },
            url: URL.createObjectURL(file),
          } satisfies Asset);

        if (!existing) {
          newAssets.push(asset);
        }

        pending.push({
          asset,
          size: fitSize(asset, viewport, {
            width: rect.width,
            height: rect.height,
          }),
        });
      }

      if (newAssets.length > 0) {
        setAssets((previous) => {
          const next = { ...previous };
          for (const asset of newAssets) {
            next[asset.id] = asset;
          }
          return next;
        });
      }
      // Placement consults the board, not the batch: pasting the same image
      // twice is two ingests, each starting from index 0, so without this the
      // second copy would land exactly under the first.
      const taken = nodes.map((node) => ({ x: node.x, y: node.y }));
      const added: BoardNode[] = [];
      for (const { asset, size } of pending) {
        const origin = cascadeFreeOrigin(taken, placeCentred(centre, size));
        taken.push(origin);
        added.push({
          id: crypto.randomUUID(),
          kind: "image",
          x: origin.x,
          y: origin.y,
          w: size.w,
          h: size.h,
          assetId: asset.id,
        });
      }

      // Paste is undoable (D17), so it goes through the history stack like any
      // other mutation rather than writing to the store directly.
      commit(insertNodes(nodes, added, `paste ${added.length} image(s)`));
    },
    [assets, commit, nodes, setAssets, surfaceRef, viewport],
  );

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const files = imageFilesFrom(event.clipboardData);
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      // Paste has no coordinates of its own, so it lands at the viewport
      // centre rather than wherever the pointer happens to rest.
      void ingestFiles(files, null);
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [ingestFiles]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    function handleDragOver(event: DragEvent) {
      // Without preventDefault the browser navigates to the dropped file.
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    }

    function handleDrop(event: DragEvent) {
      event.preventDefault();
      const files = imageFilesFrom(event.dataTransfer);
      if (files.length === 0) {
        return;
      }
      const rect = surface!.getBoundingClientRect();
      void ingestFiles(files, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    }

    surface.addEventListener("dragover", handleDragOver);
    surface.addEventListener("drop", handleDrop);
    return () => {
      surface.removeEventListener("dragover", handleDragOver);
      surface.removeEventListener("drop", handleDrop);
    };
  }, [ingestFiles, surfaceRef]);
}
