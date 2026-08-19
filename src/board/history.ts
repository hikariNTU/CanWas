import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import { applyPatch, tombstonesAfter, type Change } from "@/board/patch";
import { boardNodesAtom, tombstonesAtom } from "@/board/store";
import type { BoardNode, NodeId, Tombstone } from "@/board/types";

const MAX_DEPTH = 200;

interface HistoryStack {
  past: Change[];
  future: Change[];
}

const EMPTY: HistoryStack = { past: [], future: [] };

/**
 * Per-board, in-memory, cleared on reload (D16). Being empty at startup is what
 * makes the asset mark-and-sweep provably safe rather than carefully safe.
 */
const historyAtom = atom<Record<string, HistoryStack>>({});

/** Node selection is not undoable (D17) and lives outside the history stack. */
export const selectionAtom = atom<Record<string, NodeId[]>>({});

/** Builds a Change from whatever the node list is *at commit time*. */
export type ChangeBuilder = (nodes: readonly BoardNode[]) => Change;

/**
 * Commit, undo and redo are write atoms rather than callbacks over React state.
 *
 * A write atom reads the store synchronously through `get`, so a mutation is
 * always built against current nodes. Building from a render-time snapshot
 * meant that starting a second gesture before React had re-rendered produced a
 * Change — and an inverse — derived from stale geometry, which showed up as
 * nodes jumping when a drag and a resize followed each other quickly.
 */
export const commitAtom = atom(
  null,
  (get, set, boardId: string, build: ChangeBuilder) => {
    const nodesByBoard = get(boardNodesAtom);
    const nodes = nodesByBoard[boardId] ?? [];
    const change = build(nodes);
    if (change.apply.length === 0) {
      return;
    }

    // One clock reading for the whole change, so every node it touches carries
    // the same stamp and a merge cannot split a single action in half.
    const now = Date.now();
    set(boardNodesAtom, {
      ...nodesByBoard,
      [boardId]: applyPatch(nodes, change.apply, now),
    });
    recordTombstones(get, set, boardId, change.apply, now);

    const history = get(historyAtom);
    const current = history[boardId] ?? EMPTY;
    set(historyAtom, {
      ...history,
      [boardId]: {
        past: [...current.past, change].slice(-MAX_DEPTH),
        // A new action makes the redo branch unreachable.
        future: [],
      },
    });
  },
);

export const undoAtom = atom(null, (get, set, boardId: string) => {
  const history = get(historyAtom);
  const current = history[boardId] ?? EMPTY;
  const change = current.past.at(-1);
  if (!change) {
    return;
  }
  const nodesByBoard = get(boardNodesAtom);
  const now = Date.now();
  set(boardNodesAtom, {
    ...nodesByBoard,
    [boardId]: applyPatch(nodesByBoard[boardId] ?? [], change.invert, now),
  });
  recordTombstones(get, set, boardId, change.invert, now);
  set(historyAtom, {
    ...history,
    [boardId]: {
      past: current.past.slice(0, -1),
      future: [change, ...current.future],
    },
  });
});

export const redoAtom = atom(null, (get, set, boardId: string) => {
  const history = get(historyAtom);
  const current = history[boardId] ?? EMPTY;
  const [change, ...rest] = current.future;
  if (!change) {
    return;
  }
  const nodesByBoard = get(boardNodesAtom);
  const now = Date.now();
  set(boardNodesAtom, {
    ...nodesByBoard,
    [boardId]: applyPatch(nodesByBoard[boardId] ?? [], change.apply, now),
  });
  recordTombstones(get, set, boardId, change.apply, now);
  set(historyAtom, {
    ...history,
    [boardId]: { past: [...current.past, change], future: rest },
  });
});

/**
 * Folds a patch's deletions into the board's tombstones.
 *
 * Every path that applies a patch goes through here — commit, undo and redo
 * alike. An undo that put a node back without clearing its tombstone would see
 * the node deleted again by the next sync, which is a bug nobody could
 * reproduce locally.
 */
function recordTombstones(
  get: (atom: typeof tombstonesAtom) => Record<string, Tombstone[]>,
  set: (
    atom: typeof tombstonesAtom,
    value: Record<string, Tombstone[]>,
  ) => void,
  boardId: string,
  patch: Change["apply"],
  now: number,
): void {
  const all = get(tombstonesAtom);
  const next = tombstonesAfter(all[boardId] ?? [], patch, now);
  if (next !== (all[boardId] ?? [])) {
    set(tombstonesAtom, { ...all, [boardId]: next });
  }
}

export function useSelection(boardId: string) {
  const [all, setAll] = useAtom(selectionAtom);
  const selection = all[boardId] ?? [];

  const setSelection = useCallback(
    (ids: NodeId[]) => setAll((previous) => ({ ...previous, [boardId]: ids })),
    [boardId, setAll],
  );

  const toggle = useCallback(
    (id: NodeId, additive: boolean) =>
      setAll((previous) => {
        const current = previous[boardId] ?? [];
        if (!additive) {
          return { ...previous, [boardId]: [id] };
        }
        const next = current.includes(id)
          ? current.filter((candidate) => candidate !== id)
          : [...current, id];
        return { ...previous, [boardId]: next };
      }),
    [boardId, setAll],
  );

  return { selection, setSelection, toggle };
}

export function useBoardHistory(boardId: string) {
  const commitChange = useSetAtom(commitAtom);
  const undoChange = useSetAtom(undoAtom);
  const redoChange = useSetAtom(redoAtom);
  const stack = useAtomValue(historyAtom)[boardId] ?? EMPTY;

  /**
   * A gesture must call this exactly once, at its end — committing per
   * pointermove would bury every real action under hundreds of entries (D17).
   */
  const commit = useCallback(
    (build: ChangeBuilder) => commitChange(boardId, build),
    [boardId, commitChange],
  );

  return {
    commit,
    undo: useCallback(() => undoChange(boardId), [boardId, undoChange]),
    redo: useCallback(() => redoChange(boardId), [boardId, redoChange]),
    canUndo: stack.past.length > 0,
    canRedo: stack.future.length > 0,
  };
}
