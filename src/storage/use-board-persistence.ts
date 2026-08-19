import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useState } from "react";

import { withOrderKeys } from "@/board/order";
import { assetsAtom, boardNodesAtom, readNodes } from "@/board/store";
import { assetIdsOf, type Asset } from "@/board/types";
import { IDENTITY_VIEWPORT } from "@/canvas/coords";
import { readViewport, viewportsAtom } from "@/canvas/viewport-atom";
import { getAsset, getBoard, putBoard, type StoredBoard } from "@/storage/db";
import { boardsMetaAtom } from "@/storage/boards-atom";
import { listBoards } from "@/storage/board-actions";

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
  const store = useStore();
  const setAssets = useSetAtom(assetsAtom);
  const setNodesByBoard = useSetAtom(boardNodesAtom);
  const setViewports = useSetAtom(viewportsAtom);
  const setBoardsMeta = useSetAtom(boardsMetaAtom);

  const nodes = readNodes(useAtomValue(boardNodesAtom), boardId);
  const viewport = readViewport(useAtomValue(viewportsAtom), boardId);

  // Derived rather than reset in the effect: switching boards makes this false
  // immediately, with no extra render and no window where the previous board's
  // nodes are shown as if they belonged to the new one.
  const [hydratedBoardId, setHydratedBoardId] = useState<string | null>(null);
  const hydrated = hydratedBoardId === boardId;

  /**
   * Every write reads current state from the store, never a render snapshot.
   *
   * A debounced timer fires long after the render that scheduled it, so a save
   * carrying a captured snapshot silently overwrites newer content. The
   * viewport save used to do exactly that: it re-ran only when the viewport
   * changed, kept writing the node list from hydration time, and wiped
   * everything pasted or resized since (D22).
   */
  const save = useCallback(
    (options: { bumpUpdatedAt: boolean }) => {
      const meta = store.get(boardsMetaAtom)[boardId];
      if (!meta) {
        return;
      }
      const record: StoredBoard = {
        ...meta,
        nodes: store.get(boardNodesAtom)[boardId] ?? [],
        viewport: store.get(viewportsAtom)[boardId] ?? IDENTITY_VIEWPORT,
      };
      if (options.bumpUpdatedAt) {
        record.updatedAt = Date.now();
        store.set(boardsMetaAtom, {
          ...store.get(boardsMetaAtom),
          [boardId]: { ...meta, updatedAt: record.updatedAt },
        });
      }
      void putBoard(record);
    },
    [boardId, store],
  );

  useEffect(() => {
    let cancelled = false;

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

      // Assets are content-addressed, so one already in memory is
      // byte-identical and its object URL can be reused for the whole session.
      const inMemory = store.get(assetsAtom);
      const needed = [...new Set(assetIdsOf(stored.nodes))];
      const loaded = await Promise.all(
        needed.filter((id) => !inMemory[id]).map((id) => getAsset(id)),
      );
      if (cancelled) {
        return;
      }

      const restored: Record<string, Asset> = {};
      for (const record of loaded) {
        if (record) {
          // `blob:` URLs do not survive a reload, so they are recreated here.
          restored[record.id] = {
            ...record,
            url: URL.createObjectURL(record.blob),
          };
        }
      }

      if (Object.keys(restored).length > 0) {
        setAssets((previous) => ({ ...restored, ...previous }));
      }
      // Boards written before order keys existed carry none, and their array
      // order is what the paint order was. Filling them in on the way out of
      // storage is the only place that knows both (D55).
      setNodesByBoard((previous) => ({
        ...previous,
        [boardId]: withOrderKeys(stored.nodes),
      }));
      setViewports((previous) => ({ ...previous, [boardId]: stored.viewport }));
      // The menu lists every board (D31), so all metadata is loaded here
      // rather than by a separate screen.
      const everyBoard = await listBoards();
      if (cancelled) {
        return;
      }
      setBoardsMeta((previous) => ({
        ...previous,
        ...Object.fromEntries(everyBoard.map((meta) => [meta.id, meta])),
        [boardId]: {
          id: stored.id,
          name: stored.name,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
        },
      }));
      setHydratedBoardId(boardId);
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId, setAssets, setBoardsMeta, setNodesByBoard, setViewports, store]);

  // Content changes bump `updatedAt`.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const timer = setTimeout(
      () => save({ bumpUpdatedAt: true }),
      CONTENT_SAVE_DELAY,
    );
    return () => clearTimeout(timer);
  }, [hydrated, nodes, save]);

  // Viewport is view state: persisted, but it must never bump `updatedAt` or
  // "last edited" degrades into "last opened".
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const timer = setTimeout(
      () => save({ bumpUpdatedAt: false }),
      VIEWPORT_SAVE_DELAY,
    );
    return () => clearTimeout(timer);
  }, [hydrated, save, viewport]);

  // Debounced saves lose the tail of a session: closing the tab inside the
  // debounce window keeps the asset bytes, written immediately, but drops the
  // node that referenced them. Flush on hide, which covers tab close, tab
  // switch and mobile backgrounding.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    function flushOnHide() {
      if (document.visibilityState === "hidden") {
        save({ bumpUpdatedAt: false });
      }
    }
    // `pagehide` flushes unconditionally. Gating it on visibilityState made it
    // a no-op for the most common way a session ends — a reload or a
    // navigation, where the page is still "visible" as it goes away.
    function flushOnUnload() {
      save({ bumpUpdatedAt: false });
    }
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnUnload);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnUnload);
    };
  }, [hydrated, save]);

  return { hydrated };
}
