import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect } from "react";

import { getSyncBase } from "@/storage/db";
import { authAtom } from "@/sync/auth";
import { selectedTransport } from "@/sync/transport";

/**
 * Stopping a board from being edited into a corner it cannot get out of.
 *
 * A board that has synced before carries a sync base — proof that a remote
 * copy of it exists. On a reload where nothing can reach that remote, this
 * device is editing blind: it has not read what the other devices did, and
 * every change it makes is a change the merge will have to guess about later.
 * The window is not rare. A Drive token lasts an hour, so most reloads of a
 * board that has been open a while land in exactly this state, and the sync
 * status reads "off", which looks like an invitation rather than like
 * something that stopped working.
 *
 * So the first edit is held and the choice is put to the user (D74). Held
 * rather than dropped: a mutation here is a function of the current nodes, so
 * replaying it after a reconnect and a pull is not stale — a delete of a node
 * the remote had already deleted simply replays as nothing.
 *
 * Being offline is deliberately *not* one of these states. No click fixes it,
 * and this app ships a service worker that promises the board works offline.
 */

/** Boards this device has synced before, learned from the sync base on open. */
const remoteBoardsAtom = atom<Record<string, boolean>>({});

/** Records that a board has a remote. Written on open, and by tests. */
export const noteRemoteBoardAtom = atom(null, (get, set, boardId: string) => {
  set(remoteBoardsAtom, { ...get(remoteBoardsAtom), [boardId]: true });
});

/** Boards where the user has answered "edit anyway". Cleared by a reload. */
const allowedBoardsAtom = atom<Record<string, boolean>>({});

/** The edit waiting on an answer, if any. Read by the dialog. */
export const heldEditAtom = atom<{ boardId: string; run: () => void } | null>(
  null,
);

/** Whether a transport could run at all, which is what "off" really means. */
function reachable(auth: { status: string }): boolean {
  // The fake remote is local and needs no account, so a board pointed at it is
  // never cut off.
  return selectedTransport() === "fake" || auth.status === "signedIn";
}

/**
 * Runs `edit`, or holds it and raises the dialog.
 *
 * Returns whether it ran, for callers that need to know — a gesture that was
 * held must not also clear its own selection or close its own editor.
 */
export const guardedEditAtom = atom(
  null,
  (get, set, boardId: string, edit: () => void): boolean => {
    const blocked =
      get(remoteBoardsAtom)[boardId] === true &&
      get(allowedBoardsAtom)[boardId] !== true &&
      !reachable(get(authAtom)) &&
      // `!== false` rather than a plain read: a runtime that does not report
      // connectivity at all is treated as online, which is the state this
      // guard is for. Only an explicit "offline" opts out.
      navigator.onLine !== false;
    if (!blocked) {
      edit();
      return true;
    }
    // A second edit while the dialog is up keeps the first one. The dialog is
    // modal, so this is the rare case of a keyboard shortcut fired at it.
    if (get(heldEditAtom) === null) {
      set(heldEditAtom, { boardId, run: edit });
    }
    return false;
  },
);

/** "Edit anyway": stop asking for this board, and let the held edit through. */
export const allowEditsAtom = atom(null, (get, set, boardId: string) => {
  set(allowedBoardsAtom, { ...get(allowedBoardsAtom), [boardId]: true });
  const held = get(heldEditAtom);
  set(heldEditAtom, null);
  held?.run();
});

/** Releases the held edit after a reconnect has actually pulled. */
export const releaseHeldEditAtom = atom(null, (get, set) => {
  const held = get(heldEditAtom);
  set(heldEditAtom, null);
  held?.run();
});

export const discardHeldEditAtom = atom(null, (_get, set) => {
  set(heldEditAtom, null);
});

/**
 * Records whether this board has a remote, from its sync base.
 *
 * Read once when the board opens rather than watched: a base only appears
 * after a successful round, and a device that has just synced is by definition
 * not the device this guard is about.
 */
export function useKnownRemote(boardId: string) {
  const store = useStore();
  useEffect(() => {
    let cancelled = false;
    void getSyncBase(boardId).then((base) => {
      if (cancelled || !base) {
        return;
      }
      store.set(noteRemoteBoardAtom, boardId);
    });
    return () => {
      cancelled = true;
    };
  }, [boardId, store]);
}

/**
 * Wraps an edit so it goes through the guard.
 *
 * The returned function is stable, and reads everything it needs at call time
 * from the store — the same reason `commitAtom` is a write atom rather than a
 * callback over React state.
 */
export function useEditGuard(boardId: string): (edit: () => void) => boolean {
  const guard = useSetAtom(guardedEditAtom);
  return useCallback(
    (edit: () => void) => guard(boardId, edit),
    [boardId, guard],
  );
}

export function useHeldEdit() {
  return useAtomValue(heldEditAtom);
}
