import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useBoardHistory } from "@/board/history";
import { replaceNodes } from "@/board/mutations";
import {
  assetsAtom,
  boardNodesAtom,
  hydratedBoardsAtom,
  tombstonesAtom,
} from "@/board/store";
import { readIntrinsicSize } from "@/board/ingest";
import { isUntouchedBoard, type OcrState } from "@/board/types";
import { ocrClient, selectedEngine } from "@/ocr/client";
import {
  adoptBoardMetaAtom,
  discardPlaceholderAtom,
} from "@/storage/board-actions";
import { boardsMetaAtom } from "@/storage/boards-atom";
import { getSyncBase, putAsset, putSyncBase } from "@/storage/db";
import { authAtom, isLive } from "@/sync/auth";
import { createDriveTransport } from "@/sync/drive-transport";
import { fakeRemote } from "@/sync/fake-remote";
import type { SyncBoard } from "@/sync/merge";
import { selectedTransport, type SyncTransport } from "@/sync/transport";
import { settleRound } from "@/sync/settle";
import { reconcileBoards } from "@/sync/reconcile";
import { syncBoard } from "@/sync/sync-board";

/** How long the board must sit still before a push. Longer than the local save. */
const QUIET_MS = 2500;

export type SyncStatus =
  | { state: "off" }
  | { state: "idle"; at?: number }
  | { state: "syncing" }
  | { state: "failed"; message: string };

export const syncStatusAtom = atom<SyncStatus>({ state: "off" });

/**
 * The live transport, for the handful of places outside the loop that need it.
 *
 * Published rather than rebuilt, because building a second Drive transport
 * would mean a second walk of the folder tree — three lookups and three
 * listings — to learn what the first one already knows. `null` whenever there
 * is nothing connected, which is the state every reader has to handle anyway.
 */
export const syncTransportAtom = atom<SyncTransport | null>(null);

/**
 * Keeps one board in step with the remote.
 *
 * Pulls when the board opens and pushes once local edits go quiet, rather than
 * on every change: a drag is one Change but a typing session is many, and each
 * push is a whole-board write.
 *
 * IndexedDB stays the source of truth throughout. Everything here is best
 * effort — a failed round leaves the local board exactly as it was, which is
 * the behaviour the app already has offline.
 */
export function useSync(boardId: string): {
  status: SyncStatus;
  syncNow: () => void;
} {
  const store = useStore();
  const auth = useAtomValue(authAtom);
  const setStatus = useSetAtom(syncStatusAtom);
  const status = useAtomValue(syncStatusAtom);
  const { commit } = useBoardHistory(boardId);
  const running = useRef(false);

  const transport = useMemo((): SyncTransport | null => {
    if (selectedTransport() === "fake") {
      return fakeRemote;
    }
    // Drive needs a live token, and the token is fetched at call time rather
    // than captured: it lasts an hour, and a captured one would start failing
    // exactly one hour into a session.
    return auth.status === "signedIn"
      ? createDriveTransport(async (renew) => {
          const current = store.get(authAtom);
          if (current.status !== "signedIn") {
            // Not an expected state: the loop only runs while signed in.
            // Throwing beats a silent no-op that looks like a board with
            // nothing to sync.
            throw new Error("Drive transport used while signed out");
          }
          if (!renew && isLive(current.session)) {
            return current.session;
          }
          // No renewal happens here, because none is possible. Google's token
          // model has no silent path — every token comes from a popup, and a
          // popup needs a click. A sync round is a timer, not a click, so
          // asking here would open a window the browser blocks.
          //
          // The session is marked expired instead, which puts a red dot on the
          // button and turns it into Reconnect. That is one click, and unlike a
          // blocked popup it is a click the user can see the reason for.
          store.set(authAtom, { status: "expired" });
          throw new Error(
            "The Drive session has expired. Reconnect to keep syncing.",
          );
        })
      : null;
  }, [auth.status, store]);

  const publishTransport = useSetAtom(syncTransportAtom);
  useEffect(() => {
    publishTransport(transport);
  }, [publishTransport, transport]);

  const hydrated = useAtomValue(hydratedBoardsAtom)[boardId] === true;

  const runOnce = useCallback(async () => {
    // Never sync a board that is still loading. It looks empty, and an empty
    // board against a base with nodes reads as "this device deleted
    // everything" — which would then be pushed, and would look deliberate.
    if (
      !transport ||
      running.current ||
      !store.get(hydratedBoardsAtom)[boardId]
    ) {
      return;
    }
    running.current = true;
    setStatus({ state: "syncing" });
    try {
      const meta = store.get(boardsMetaAtom)[boardId];
      if (!meta) {
        return;
      }
      const local: SyncBoard = {
        id: boardId,
        name: meta.name,
        nodes: store.get(boardNodesAtom)[boardId] ?? [],
        tombstones: store.get(tombstonesAtom)[boardId] ?? [],
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        // Carried, so that deleting the board on screen actually reaches the
        // remote. Dropping it here would push the board back up as live on the
        // very next round and undelete it everywhere.
        ...(meta.deletedAt === undefined ? {} : { deletedAt: meta.deletedAt }),
      };
      const storedBase = await getSyncBase(boardId);

      // A board nothing has ever been done to stays on this device (D79). The
      // base is half the test: once the remote has seen this board it keeps
      // syncing however empty it gets, because from then on silence here is a
      // claim about the board rather than an absence of one.
      //
      // Reported as idle without a time. Something did happen — the round ran
      // and decided — but stamping "last synced" on a board that has never
      // been anywhere would be the one lie this status can tell.
      if (!storedBase && isUntouchedBoard(local)) {
        setStatus({ state: "idle" });
        return;
      }

      const result = await syncBoard({
        transport,
        local: { board: local, assets: store.get(assetsAtom) },
        base: (storedBase?.board as SyncBoard | undefined) ?? null,
        onAsset: async (id, blob, words) => {
          const size = await readIntrinsicSize(blob);
          // Stored already read when the remote had a reading for it. An asset
          // that lands unread is picked up by the recognition queue on the very
          // next render, which is the cost this is here to avoid.
          const ocr: OcrState = words
            ? { status: "done", words: [...words] }
            : { status: "idle" };
          const record = {
            id,
            blob,
            width: size.width,
            height: size.height,
            // The id *is* the hash of the original bytes, which is why it can
            // travel as a filename and be trusted on arrival.
            hash: id,
            ocr,
          };
          await putAsset(record);
          if (words) {
            ocrClient.adopt(id);
          }
          store.set(assetsAtom, {
            ...store.get(assetsAtom),
            [id]: { ...record, url: URL.createObjectURL(blob) },
          });
        },
        engine: selectedEngine(),
        onText: async (id, words) => {
          const asset = store.get(assetsAtom)[id];
          // The asset may have been swept between the round starting and this
          // arriving. A reading with no image to sit on is nothing.
          if (!asset || asset.ocr.status === "done") {
            return;
          }
          const ocr: OcrState = { status: "done", words: [...words] };
          const { url: _url, ...record } = { ...asset, ocr };
          await putAsset(record);
          store.set(assetsAtom, {
            ...store.get(assetsAtom),
            [id]: { ...asset, ocr },
          });
          // Otherwise the local pipeline reads pixels that have already been
          // read: `useOcr` adopts a done asset, but only one it saw arrive.
          ocrClient.adopt(id);
        },
      });

      // The board may have moved while the round was in the air — a paste, a
      // drag, a delete. The round never saw those and its result therefore
      // says they do not exist, so landing it as-is would undo every one of
      // them, tombstones included, and the next push would delete them
      // everywhere. Settled against the board as it is now instead.
      const settled = settleRound({
        started: local,
        merged: result.merged,
        current: {
          ...local,
          nodes: store.get(boardNodesAtom)[boardId] ?? [],
          tombstones: store.get(tombstonesAtom)[boardId] ?? [],
        },
      });

      // The merge lands as an ordinary Change so it has an inverse and undo
      // still means something (D16), and with stamps preserved so the nodes
      // keep the times the devices that edited them recorded.
      commit((nodes) => replaceNodes(nodes, settled.nodes, "sync"), "preserve");
      // The board's own fields too. They were being merged, pushed to the
      // remote, and then thrown away here — so a rename never crossed between
      // devices, and a board opened from a link kept its raw id for a name.
      store.set(adoptBoardMetaAtom, boardId, {
        name: settled.name,
        createdAt: settled.createdAt,
        updatedAt: settled.updatedAt,
        deletedAt: settled.deletedAt,
      });
      store.set(tombstonesAtom, {
        ...store.get(tombstonesAtom),
        [boardId]: settled.tombstones,
      });

      // The base is what the *remote* now holds, which is what the round
      // pushed — not what this device happens to hold a moment later. Recording
      // the local list here was the second half of the same bug: a node that
      // arrived mid-round would enter the base without ever reaching Drive, and
      // the next round would read "in the base, absent from the remote" as the
      // remote having deleted it.
      await putSyncBase({
        boardId,
        board: result.merged,
        syncedAt: Date.now(),
      });
      setStatus({ state: "idle", at: Date.now() });
    } catch (error) {
      setStatus({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running.current = false;
    }
  }, [boardId, commit, setStatus, store, transport]);

  // Everything that is not the open board, once per connection.
  //
  // Keyed on the transport rather than on the board, so switching boards does
  // not run it again: it walks every board either side has, which is the one
  // thing that should not happen on every navigation. A reload or a fresh
  // sign-in is a new transport, and that is when it is worth doing.
  const reconciled = useRef<SyncTransport | null>(null);
  // Read through a ref so the pass sees navigations that happen while it runs,
  // rather than the board that was open when it started. Written in an effect
  // rather than during render, which is the only time a ref is allowed to move.
  const openBoard = useRef(boardId);
  useEffect(() => {
    openBoard.current = boardId;
  }, [boardId]);
  useEffect(() => {
    if (!transport || reconciled.current === transport) {
      return;
    }
    reconciled.current = transport;
    void reconcileBoards({
      transport,
      skip: () => openBoard.current,
      engine: selectedEngine(),
      onBoard: (meta) => {
        // The menu fills in as the pass runs rather than at the end of it, so
        // a board that arrives from another device is reachable immediately.
        store.set(boardsMetaAtom, {
          ...store.get(boardsMetaAtom),
          [meta.id]: meta,
        });
      },
      // Deliberately not surfaced as a sync failure. The status belongs to the
      // open board, and telling someone their board failed to sync because a
      // different board did would send them looking in the wrong place.
    })
      .then(async (report) => {
        // A device that has just met this account for the first time is
        // standing on the empty board it made before it knew the account had
        // any. Now that the real ones are here, that board is in the way: it
        // is the newest thing in the menu and it is the thing on screen, so
        // the first sight of a synced account would be a blank canvas (D79).
        //
        // Only arrivals count. Graves are not boards, and a pass that pushed
        // or skipped has told this device nothing it did not already know.
        if (report.arrived.length === 0) {
          return;
        }
        const boardId = openBoard.current;
        const meta = store.get(boardsMetaAtom)[boardId];
        if (!meta) {
          return;
        }
        // Read from the atoms rather than from disk: this is the open board,
        // and a paste made while the pass was in the air is on screen before
        // it is anywhere else. Anything at all having happened to it makes it
        // a real board, which is what makes discarding it safe.
        const open = {
          nodes: store.get(boardNodesAtom)[boardId] ?? [],
          tombstones: store.get(tombstonesAtom)[boardId] ?? [],
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          ...(meta.deletedAt === undefined
            ? {}
            : { deletedAt: meta.deletedAt }),
        };
        if (!isUntouchedBoard(open) || (await getSyncBase(boardId))) {
          return;
        }
        store.set(discardPlaceholderAtom, boardId);
      })
      .catch(() => {});
    // `boardId` is deliberately not a dependency: the pass runs once per
    // connection, and the ref above is what keeps it current.
  }, [store, transport]);

  // Pull when the board opens or a transport appears.
  useEffect(() => {
    if (!transport) {
      setStatus({ state: "off" });
      return;
    }
    if (hydrated) {
      void runOnce();
    }
  }, [hydrated, runOnce, setStatus, transport]);

  // Push once local edits go quiet.
  //
  // The board's own fields count as edits too. Watching only the node list
  // meant a rename never started a round of its own: it sat on the device
  // until some unrelated paste or drag happened to carry it up, and on a board
  // nobody touched again, forever. Read as scalars rather than as the metadata
  // object, so the write every round makes on the way out — `adoptBoardMeta`,
  // with the merged fields — cannot arm the timer that would start the next
  // one.
  const nodes = useAtomValue(boardNodesAtom)[boardId];
  const meta = useAtomValue(boardsMetaAtom)[boardId];
  const name = meta?.name;
  const deletedAt = meta?.deletedAt;
  useEffect(() => {
    if (!transport || nodes === undefined) {
      return;
    }
    const timer = setTimeout(() => void runOnce(), QUIET_MS);
    return () => clearTimeout(timer);
  }, [nodes, name, deletedAt, runOnce, transport]);

  // Exposed so the sync button can ask for a round now rather than at the next
  // quiet moment — the thing you press before closing a laptop.
  return { status, syncNow: () => void runOnce() };
}
