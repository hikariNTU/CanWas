import { atom } from "jotai";

import { boardNodesAtom, tombstonesAtom } from "@/board/store";
import { createId } from "@/lib/id";
import { IDENTITY_VIEWPORT } from "@/canvas/coords";
import { viewportsAtom } from "@/canvas/viewport-atom";
import { boardsMetaAtom, type BoardMeta } from "@/storage/boards-atom";
import {
  deleteBoard,
  getAllBoards,
  putBoard,
  type StoredBoard,
} from "@/storage/db";

export function metaOf(board: StoredBoard): BoardMeta {
  return {
    id: board.id,
    name: board.name,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

/** Most recently edited first — the order the board list is shown in. */
export async function listBoards(): Promise<BoardMeta[]> {
  const boards = await getAllBoards();
  return boards.map(metaOf).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createBoard(name: string): Promise<StoredBoard> {
  const now = Date.now();
  const board: StoredBoard = {
    id: createId(),
    name,
    nodes: [],
    viewport: IDENTITY_VIEWPORT,
    createdAt: now,
    updatedAt: now,
  };
  await putBoard(board);
  return board;
}

export async function removeBoard(id: string): Promise<void> {
  await deleteBoard(id);
  // Orphaned assets are reclaimed by the startup sweep (D14), not here:
  // sweeping now could take bytes a still-open board is using.
}

/**
 * Resolves what `/` should open: the most recently edited board, creating one
 * if the store is empty. Returns metadata rather than an id, because the URL
 * carries the name as a slug alongside it.
 */
export async function resolveLandingBoard(
  fallbackName: string,
): Promise<BoardMeta> {
  const boards = await listBoards();
  return boards[0] ?? metaOf(await createBoard(fallbackName));
}

/**
 * Renaming is not undoable — the history stack covers board content only
 * (D17) — so it writes straight through rather than going via `commit`.
 *
 * Nodes and viewport are read from the store at write time, never captured
 * (D26): `putBoard` replaces the whole record, so writing a stale list here
 * would silently discard content.
 */
/**
 * Takes the board's own fields from a sync round.
 *
 * Separate from renaming because it is the opposite of an edit: renaming says
 * *this device decided this*, and stamps the time to prove it. Adopting says
 * this device was told, and must not stamp anything — a merge result that
 * announced itself as a fresh local edit would win the next round's
 * last-writer-wins on the strength of having been received.
 *
 * Without this the name merged correctly, travelled to the remote, and was
 * then dropped on the floor: nothing above `boardNodesAtom` was ever written
 * back, so a board renamed on the laptop kept its old name on the phone
 * forever, and a board opened from a link showed its raw id as its name.
 */
export const adoptBoardMetaAtom = atom(
  null,
  (
    get,
    set,
    boardId: string,
    incoming: { name: string; createdAt: number; updatedAt: number },
  ) => {
    const meta = get(boardsMetaAtom)[boardId];
    if (
      !meta ||
      (meta.name === incoming.name &&
        meta.createdAt === incoming.createdAt &&
        meta.updatedAt === incoming.updatedAt)
    ) {
      return;
    }
    const next = { ...meta, ...incoming };
    set(boardsMetaAtom, { ...get(boardsMetaAtom), [boardId]: next });
    void putBoard({
      ...next,
      nodes: get(boardNodesAtom)[boardId] ?? [],
      tombstones: get(tombstonesAtom)[boardId] ?? [],
      viewport: get(viewportsAtom)[boardId] ?? IDENTITY_VIEWPORT,
    });
  },
);

export const renameBoardAtom = atom(
  null,
  (get, set, boardId: string, name: string) => {
    const meta = get(boardsMetaAtom)[boardId];
    const trimmed = name.trim();
    if (!meta || trimmed === "" || trimmed === meta.name) {
      return;
    }
    const next = { ...meta, name: trimmed, updatedAt: Date.now() };
    set(boardsMetaAtom, { ...get(boardsMetaAtom), [boardId]: next });
    void putBoard({
      ...next,
      nodes: get(boardNodesAtom)[boardId] ?? [],
      viewport: get(viewportsAtom)[boardId] ?? IDENTITY_VIEWPORT,
    });
  },
);
