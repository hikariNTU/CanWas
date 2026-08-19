import { atom } from "jotai";

import type { Asset, BoardNode, Tombstone } from "@/board/types";

/**
 * In-memory only for now. IndexedDB persistence and the startup mark-and-sweep
 * land at step 5; the shapes here are already what gets written.
 */

/** Assets are shared across nodes and across boards, keyed by content hash. */
export const assetsAtom = atom<Record<string, Asset>>({});

/** Nodes per board, kept sorted by order key, which is paint order (D55). */
export const boardNodesAtom = atom<Record<string, BoardNode[]>>({});

/**
 * Deleted node ids per board, kept so a delete survives a merge (D56).
 *
 * Separate from the node list rather than a flag on it: a tombstone is not a
 * node, and everything that walks the node list — rendering, hit testing, the
 * asset sweep — would otherwise have to remember to skip them.
 */
export const tombstonesAtom = atom<Record<string, Tombstone[]>>({});

/**
 * Shared so an empty board yields a stable identity. Returning a fresh `[]`
 * made every render look like a node change, which re-armed the debounced save
 * timer continuously.
 */
const NO_NODES: BoardNode[] = [];

export function readNodes(
  nodesByBoard: Record<string, BoardNode[]>,
  boardId: string,
): BoardNode[] {
  return nodesByBoard[boardId] ?? NO_NODES;
}
