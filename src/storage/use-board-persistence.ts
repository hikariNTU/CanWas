import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";

import { assetsAtom, boardNodesAtom, readNodes } from "@/board/store";
import type { Asset } from "@/board/types";
import { IDENTITY_VIEWPORT } from "@/canvas/coords";
import { readViewport, viewportsAtom } from "@/canvas/viewport-atom";
import { getAsset, getBoard, putBoard, type StoredBoard } from "@/storage/db";
import { boardsMetaAtom, type BoardMeta } from "@/storage/boards-atom";

/** Content edits settle quickly; viewport writes are pure churn, so they wait. */
const CONTENT_SAVE_DELAY = 400;
const VIEWPORT_SAVE_DELAY = 1000;

/**
 * Loads a board and its assets, then writes changes back.
 *
 * Opening an id that does not exist creates it. There is no 404 path: boards
 * are cheap, deep links should always work, and a stray board is easier to
 * delete than a dead link is to explain.
 */
export function useBoardPersistence(boardId: string) {
  const [assets, setAssets] = useAtom(assetsAtom);
  const setNodesByBoard = useSetAtom(boardNodesAtom);
  const setViewports = useSetAtom(viewportsAtom);
  const [boardsMeta, setBoardsMeta] = useAtom(boardsMetaAtom);

  const nodes = readNodes(useAtomValue(boardNodesAtom), boardId);
  const viewport = readViewport(useAtomValue(viewportsAtom), boardId);

  const [hydrated, setHydrated] = useState(false);

  // Saves need the current meta without re-running on every meta change.
  const metaRef = useRef<BoardMeta | null>(null);
  metaRef.current = boardsMeta[boardId] ?? null;

  // Assets are content-addressed, so one already in memory is byte-identical
  // and its object URL can be reused across boards for the whole session.
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);

    void (async () => {
      const now = Date.now();
      const stored: StoredBoard = (await getBoard(boardId)) ?? {
        id: boardId,
        name: boardId,
        nodes: [],
        viewport: IDENTITY_VIEWPORT,
        createdAt: now,
        updatedAt: now,
      };

      const needed = [...new Set(stored.nodes.map((node) => node.assetId))];
      const missing = needed.filter((id) => !assetsRef.current[id]);
      const loaded = await Promise.all(missing.map((id) => getAsset(id)));
      if (cancelled) {
        return;
      }

      const restored: Record<string, Asset> = {};
      for (const record of loaded) {
        if (record) {
          restored[record.id] = {
            ...record,
            // `blob:` URLs do not survive a reload, so they are recreated here.
            url: URL.createObjectURL(record.blob),
          };
        }
      }

      if (Object.keys(restored).length > 0) {
        setAssets((previous) => ({ ...restored, ...previous }));
      }
      setNodesByBoard((previous) => ({ ...previous, [boardId]: stored.nodes }));
      setViewports((previous) => ({ ...previous, [boardId]: stored.viewport }));
      setBoardsMeta((previous) => ({
        ...previous,
        [boardId]: {
          id: stored.id,
          name: stored.name,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
        },
      }));
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId, setAssets, setBoardsMeta, setNodesByBoard, setViewports]);

  // Content changes bump `updatedAt`.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const timer = setTimeout(() => {
      const meta = metaRef.current;
      if (!meta) {
        return;
      }
      const updatedAt = Date.now();
      void putBoard({ ...meta, nodes, viewport, updatedAt });
      setBoardsMeta((previous) => ({
        ...previous,
        [boardId]: { ...meta, updatedAt },
      }));
    }, CONTENT_SAVE_DELAY);
    return () => clearTimeout(timer);
    // `viewport` is intentionally absent: it is saved by the effect below, and
    // including it here would make panning bump `updatedAt`.
    // eslint-disable-next-line react/exhaustive-deps
  }, [boardId, hydrated, nodes, setBoardsMeta]);

  // Viewport is view state: persisted, but it must never bump `updatedAt` or
  // "last edited" degrades into "last opened".
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const timer = setTimeout(() => {
      const meta = metaRef.current;
      if (meta) {
        void putBoard({ ...meta, nodes, viewport });
      }
    }, VIEWPORT_SAVE_DELAY);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react/exhaustive-deps
  }, [boardId, hydrated, viewport]);

  // Debounced saves lose the tail of a session: closing the tab within the
  // debounce window keeps the asset bytes (written immediately) but drops the
  // node that referenced them. Flush on hide, which covers tab close, tab
  // switch and mobile backgrounding.
  const latestRef = useRef({ nodes, viewport });
  useEffect(() => {
    latestRef.current = { nodes, viewport };
  }, [nodes, viewport]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    function flush() {
      const meta = metaRef.current;
      if (document.visibilityState === "hidden" && meta) {
        void putBoard({ ...meta, ...latestRef.current });
      }
    }
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [hydrated]);

  return { hydrated };
}
