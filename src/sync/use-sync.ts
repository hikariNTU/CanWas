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
import { boardsMetaAtom } from "@/storage/boards-atom";
import { getSyncBase, putAsset, putSyncBase } from "@/storage/db";
import { authAtom, isLive, renewToken } from "@/sync/auth";
import { createDriveTransport } from "@/sync/drive-transport";
import { fakeRemote } from "@/sync/fake-remote";
import type { SyncBoard } from "@/sync/merge";
import { selectedTransport, type SyncTransport } from "@/sync/transport";
import { settleRound } from "@/sync/settle";
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
          try {
            // Only the token and its expiry come back. The email and the quota
            // were fetched once at sign-in and are still true.
            const fresh = await renewToken();
            const session = { ...current.session, ...fresh };
            store.set(authAtom, { status: "signedIn", session });
            return session;
          } catch (error) {
            // A renewal that fails means the grant is gone — revoked, or a
            // password change, or another device signing out. Dropping back to
            // signed out puts the button back to "connect", which is the one
            // thing that can fix it. Staying signed in would retry forever.
            store.set(authAtom, {
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        })
      : null;
  }, [auth.status, store]);

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
      };
      const storedBase = await getSyncBase(boardId);

      const result = await syncBoard({
        transport,
        local: { board: local, assets: store.get(assetsAtom) },
        base: (storedBase?.board as SyncBoard | undefined) ?? null,
        onAsset: async (id, blob) => {
          const size = await readIntrinsicSize(blob);
          const asset = {
            id,
            blob,
            width: size.width,
            height: size.height,
            // The id *is* the hash of the original bytes, which is why it can
            // travel as a filename and be trusted on arrival.
            hash: id,
            ocr: { status: "idle" } as const,
            url: URL.createObjectURL(blob),
          };
          await putAsset({
            id,
            blob,
            width: size.width,
            height: size.height,
            hash: id,
            ocr: { status: "idle" },
          });
          store.set(assetsAtom, { ...store.get(assetsAtom), [id]: asset });
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
  const nodes = useAtomValue(boardNodesAtom)[boardId];
  useEffect(() => {
    if (!transport || nodes === undefined) {
      return;
    }
    const timer = setTimeout(() => void runOnce(), QUIET_MS);
    return () => clearTimeout(timer);
  }, [nodes, runOnce, transport]);

  // Exposed so the sync button can ask for a round now rather than at the next
  // quiet moment — the thing you press before closing a laptop.
  return { status, syncNow: () => void runOnce() };
}
