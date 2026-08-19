import { atom } from "jotai";

import type { Asset, BoardNode } from "@/board/types";

/**
 * In-memory only for now. IndexedDB persistence and the startup mark-and-sweep
 * land at step 5; the shapes here are already what gets written.
 */

/** Assets are shared across nodes and across boards, keyed by content hash. */
export const assetsAtom = atom<Record<string, Asset>>({});

/** Nodes per board. Array order is paint order (D18). */
export const boardNodesAtom = atom<Record<string, BoardNode[]>>({});

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
