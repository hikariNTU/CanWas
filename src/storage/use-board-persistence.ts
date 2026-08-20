import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeNodes } from "@/board/order";
import {
  assetsAtom,
  boardNodesAtom,
  hydratedBoardsAtom,
  readNodes,
  tombstonesAtom,
} from "@/board/store";
import { assetIdsOf, type Asset, type BoardNode } from "@/board/types";
import { IDENTITY_VIEWPORT } from "@/canvas/coords";
import { readViewport, viewportsAtom } from "@/canvas/viewport-atom";
import { getAsset, getBoard, putBoard, type StoredBoard } from "@/storage/db";
import { announce, listen } from "@/storage/tab-channel";
import { listBoards } from "@/storage/board-actions";
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
  const store = useStore();
  const setAssets = useSetAtom(assetsAtom);
  const setNodesByBoard = useSetAtom(boardNodesAtom);
  const setTombstones = useSetAtom(tombstonesAtom);
  const setHydrated = useSetAtom(hydratedBoardsAtom);
  const setViewports = useSetAtom(viewportsAtom);
  const setBoardsMeta = useSetAtom(boardsMetaAtom);

  const nodes = readNodes(useAtomValue(boardNodesAtom), boardId);
  const viewport = readViewport(useAtomValue(viewportsAtom), boardId);

  // Derived rather than reset in the effect: switching boards makes this false
  // immediately, with no extra render and no window where the previous board's
  // nodes are shown as if they belonged to the new one.
  const [hydratedBoardId, setHydratedBoardId] = useState<string | null>(null);

  /**
   * The node list as it came off disk, before anything touched it.
   *
   * Without this, opening a board saved it: the content effect runs on mount,
   * sees a node list, and writes it back with a fresh `updatedAt`. Harmless on
   * one device, and destructive with two tabs — the second tab to open would
   * write its own view of the board over the first tab's newer one, and stamp
   * the result as the most recent edit so that nothing would correct it.
   *
   * It also kept "last edited" from meaning last edited, which is what the
   * board list is sorted by.
   */
  const [baseline, setBaseline] = useState<readonly BoardNode[] | null>(null);

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
        tombstones: store.get(tombstonesAtom)[boardId] ?? [],
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
      // The write has happened; whatever this tab was holding is now on disk,
      // and any other tab showing this board is out of date.
      persisted.current = record.nodes;
      announce({
        kind: "board",
        boardId,
        updatedAt: record.updatedAt,
      });
    },
    [boardId, store],
  );

  /**
   * The exact node list this tab last wrote to disk.
   *
   * Identity, not a flag: the atoms hold one array per board and every edit
   * replaces it, so "the array in the store is not the array I saved" is
   * precisely "I have work that has not landed yet". A flag would have to be
   * raised somewhere, and the only place to raise it is an effect, where a ref
   * may not be written.
   *
   * It matters because the save is debounced. A tab with unsaved work must not
   * reload the board underneath itself, or the edit about to be written is
   * discarded by the reload. The save that follows announces in turn and the
   * *other* tab reloads instead — whichever wrote last still wins, which is the
   * rule this app already had, but now both tabs agree on what happened rather
   * than one silently flattening the other.
   */
  const persisted = useRef<readonly BoardNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const now = Date.now();
      // An id this device has never seen. That is a real case — a link to a
      // board another device made — so it is materialised rather than refused,
      // and the sync round that follows fills it in.
      //
      // `updatedAt: 0`, because nothing has edited it. Stamping it with the
      // current time makes an empty placeholder the most recently touched copy
      // of that board anywhere, and the merge believes it twice over: its name
      // (the raw id, for want of anything better) wins over the real one and is
      // pushed to every other device, and a board deleted elsewhere comes back
      // from the dead. Zero says what is true — this side has no edit to offer
      // — and every field it lacks is taken from the remote on the first round.
      const stored: StoredBoard = (await getBoard(boardId)) ?? {
        id: boardId,
        name: boardId,
        nodes: [],
        tombstones: [],
        viewport: IDENTITY_VIEWPORT,
        createdAt: now,
        updatedAt: 0,
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
      // Boards written before order keys and per-node stamps existed carry
      // neither. Filling them in on the way out of storage is the only place
      // that knows both the array order and the board's own stamp (D55, D56).
      const initial = normalizeNodes(stored.nodes, stored.updatedAt);
      // Remembered so that opening a board is not mistaken for editing it.
      setBaseline(initial);
      setNodesByBoard((previous) => ({
        ...previous,
        [boardId]: initial,
      }));
      setTombstones((previous) => ({
        ...previous,
        [boardId]: stored.tombstones ?? [],
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
      setHydrated((previous) => ({ ...previous, [boardId]: true }));
    })();

    return () => {
      cancelled = true;
    };
  }, [
    boardId,
    setAssets,
    setBoardsMeta,
    setHydrated,
    setNodesByBoard,
    setTombstones,
    setViewports,
    store,
  ]);

  /**
   * Another tab wrote. Take its work rather than overwrite it.
   *
   * Only the board on screen is reloaded, and only when the other tab's record
   * is genuinely newer — a tab that hears about its own save, or about an older
   * write arriving late, does nothing. The viewport is deliberately left alone:
   * it is stored per board but it is *this* tab's view, and yanking someone's
   * scroll position because another window panned is not synchronisation, it is
   * a haunting.
   */
  const unsaved = useCallback(
    () =>
      persisted.current !== null &&
      store.get(boardNodesAtom)[boardId] !== persisted.current,
    [boardId, store],
  );

  useEffect(() => {
    return listen((message) => {
      if (message.kind === "boards") {
        // A board was created or deleted elsewhere: the list, not a board.
        // Replaced wholesale rather than merged, because a deletion has to be
        // able to remove a row — except for the board on screen, whose meta
        // this tab may have moved since its last write.
        void listBoards().then((everyBoard) => {
          setBoardsMeta((previous) => {
            const next: Record<string, BoardMeta> = Object.fromEntries(
              everyBoard.map((meta) => [meta.id, meta]),
            );
            const open = previous[boardId];
            if (open) {
              next[boardId] = open;
            }
            return next;
          });
        });
        return;
      }
      if (message.boardId !== boardId) {
        // Some other board moved — most often a rename. The menu shows every
        // board, so a name that is only right in the tab that changed it is
        // still wrong everywhere it is read.
        void getBoard(message.boardId).then((stored) => {
          if (!stored) {
            return;
          }
          setBoardsMeta((previous) => ({
            ...previous,
            [stored.id]: {
              id: stored.id,
              name: stored.name,
              createdAt: stored.createdAt,
              updatedAt: stored.updatedAt,
            },
          }));
        });
        return;
      }
      if (unsaved()) {
        return;
      }
      const known = store.get(boardsMetaAtom)[boardId];
      if (known && message.updatedAt <= known.updatedAt) {
        return;
      }
      void (async () => {
        const stored = await getBoard(boardId);
        // Checked again on the far side of the read: an edit can begin while
        // IndexedDB is answering.
        if (!stored || unsaved()) {
          return;
        }
        // Whatever the other tab added may reference an image this tab has
        // never loaded.
        const inMemory = store.get(assetsAtom);
        const missing = [...new Set(assetIdsOf(stored.nodes))].filter(
          (id) => !inMemory[id],
        );
        const loaded = await Promise.all(missing.map((id) => getAsset(id)));
        const restored: Record<string, Asset> = {};
        for (const record of loaded) {
          if (record) {
            restored[record.id] = {
              ...record,
              url: URL.createObjectURL(record.blob),
            };
          }
        }
        if (Object.keys(restored).length > 0) {
          setAssets((previous) => ({ ...restored, ...previous }));
        }
        setNodesByBoard((previous) => ({
          ...previous,
          [boardId]: normalizeNodes(stored.nodes, stored.updatedAt),
        }));
        setTombstones((previous) => ({
          ...previous,
          [boardId]: stored.tombstones ?? [],
        }));
        setBoardsMeta((previous) => ({
          ...previous,
          [boardId]: {
            id: stored.id,
            name: stored.name,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
          },
        }));
      })();
    });
  }, [
    boardId,
    setAssets,
    setBoardsMeta,
    setNodesByBoard,
    setTombstones,
    store,
    unsaved,
  ]);

  // Content changes bump `updatedAt`.
  useEffect(() => {
    if (!hydrated || nodes === baseline) {
      return;
    }
    const timer = setTimeout(
      () => save({ bumpUpdatedAt: true }),
      CONTENT_SAVE_DELAY,
    );
    return () => clearTimeout(timer);
  }, [baseline, hydrated, nodes, save]);

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
