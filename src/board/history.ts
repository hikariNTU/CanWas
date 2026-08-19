import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";

import { applyPatch, type Change } from "@/board/patch";
import { boardNodesAtom } from "@/board/store";
import type { NodeId } from "@/board/types";

const MAX_DEPTH = 200;

interface HistoryStack {
  past: Change[];
  future: Change[];
}

const EMPTY: HistoryStack = { past: [], future: [] };

/**
 * Per-board, in-memory, cleared on reload (D16). Being empty at startup is what
 * makes the asset mark-and-sweep provably safe rather than carefully safe: the
 * sweep can never reclaim bytes an undo entry still needs.
 */
const historyAtom = atom<Record<string, HistoryStack>>({});

/** Node selection is not undoable (D17) and lives outside the history stack. */
export const selectionAtom = atom<Record<string, NodeId[]>>({});

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
  const setNodesByBoard = useSetAtom(boardNodesAtom);
  const [history, setHistory] = useAtom(historyAtom);
  const stack = history[boardId] ?? EMPTY;

  /**
   * Applies a change and records it. A gesture must call this exactly once, at
   * its end — a drag that committed per pointermove would bury every real
   * action under hundreds of entries (D17).
   */
  const commit = useCallback(
    (change: Change) => {
      if (change.apply.length === 0) {
        return;
      }
      setNodesByBoard((previous) => ({
        ...previous,
        [boardId]: applyPatch(previous[boardId] ?? [], change.apply),
      }));
      setHistory((previous) => {
        const current = previous[boardId] ?? EMPTY;
        const past = [...current.past, change].slice(-MAX_DEPTH);
        // A new action makes the redo branch unreachable.
        return { ...previous, [boardId]: { past, future: [] } };
      });
    },
    [boardId, setHistory, setNodesByBoard],
  );

  const undo = useCallback(() => {
    setHistory((previous) => {
      const current = previous[boardId] ?? EMPTY;
      const change = current.past.at(-1);
      if (!change) {
        return previous;
      }
      setNodesByBoard((nodes) => ({
        ...nodes,
        [boardId]: applyPatch(nodes[boardId] ?? [], change.invert),
      }));
      return {
        ...previous,
        [boardId]: {
          past: current.past.slice(0, -1),
          future: [change, ...current.future],
        },
      };
    });
  }, [boardId, setHistory, setNodesByBoard]);

  const redo = useCallback(() => {
    setHistory((previous) => {
      const current = previous[boardId] ?? EMPTY;
      const [change, ...rest] = current.future;
      if (!change) {
        return previous;
      }
      setNodesByBoard((nodes) => ({
        ...nodes,
        [boardId]: applyPatch(nodes[boardId] ?? [], change.apply),
      }));
      return {
        ...previous,
        [boardId]: { past: [...current.past, change], future: rest },
      };
    });
  }, [boardId, setHistory, setNodesByBoard]);

  return {
    commit,
    undo,
    redo,
    canUndo: stack.past.length > 0,
    canRedo: stack.future.length > 0,
  };
}

export function useHistoryDepth(boardId: string) {
  const history = useAtomValue(historyAtom);
  const stack = history[boardId] ?? EMPTY;
  return { past: stack.past.length, future: stack.future.length };
}
