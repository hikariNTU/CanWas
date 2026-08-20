import { atom, type Atom } from "jotai";

import { boardNodesAtom, tombstonesAtom } from "@/board/store";
import { isBoardDeleted } from "@/board/types";
import { createId } from "@/lib/id";
import { IDENTITY_VIEWPORT } from "@/canvas/coords";
import { viewportsAtom } from "@/canvas/viewport-atom";
import { boardsMetaAtom, type BoardMeta } from "@/storage/boards-atom";
import { announce } from "@/storage/tab-channel";
import {
  deleteBoard,
  getAllBoards,
  getBoard,
  putBoard,
  type StoredBoard,
} from "@/storage/db";

export function metaOf(board: StoredBoard): BoardMeta {
  return {
    id: board.id,
    name: board.name,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    // Spread, not assigned: an explicit `deletedAt: undefined` on the metadata
    // survives every `{...meta}` downstream and lands in IndexedDB as a real
    // key holding `undefined`, which is not the same shape as a board that was
    // never deleted.
    ...(board.deletedAt === undefined ? {} : { deletedAt: board.deletedAt }),
  };
}

/**
 * Most recently edited first — the order the board list is shown in.
 *
 * Graves are left out. They stay on disk so the deletion can travel (D66), and
 * every reader of this list is a reader that wants boards.
 */
export async function listBoards(): Promise<BoardMeta[]> {
  const boards = await getAllBoards();
  return boards
    .filter((board) => !isBoardDeleted(board))
    .map(metaOf)
    .sort((a, b) => b.updatedAt - a.updatedAt);
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
  // The list changed rather than a board: another tab's menu is short by one.
  announce({ kind: "boards" });
  return board;
}

/**
 * Deletes a board by marking it, never by dropping the record (D66).
 *
 * A board removed from disk was resurrected on the next sync round, every
 * time: the reconcile pass walks the union of both sides, finds a board the
 * remote has and this device does not, and cannot tell "deleted here" from
 * "never seen here" — so it downloads it again. With Drive connected, deleting
 * a board was simply not possible.
 *
 * The content is kept as well as the marker. The merge lets an edit on another
 * device revive a board deleted here, and reviving it to an empty canvas would
 * be a worse answer than either device asked for. `trimDeletedBoards` empties
 * it after the retention window, which is when the images become collectable.
 */
export async function removeBoard(id: string): Promise<BoardMeta> {
  const now = Date.now();
  // A board with no local record still gets a grave. That is not a hypothetical
  // — a board can be on screen before its first debounced save has landed, and
  // it can exist only on the remote and in the menu — and refusing to bury what
  // is not on disk means the reconcile pass hands it straight back.
  const existing = (await getBoard(id)) ?? {
    id,
    name: id,
    nodes: [],
    tombstones: [],
    viewport: IDENTITY_VIEWPORT,
    createdAt: now,
    updatedAt: now,
  };
  // Both stamps, and the same value. `isBoardDeleted` compares them, so a
  // deletion that did not move `updatedAt` would be a grave that every later
  // edit stamp outranks — and a board that came back on its own.
  const grave = { ...existing, updatedAt: now, deletedAt: now };
  await putBoard(grave);
  announce({ kind: "boards" });
  // Orphaned assets are reclaimed by the startup sweep (D14), not here:
  // sweeping now could take bytes a still-open board is using — and the
  // board's own images stay reachable until it is trimmed.
  //
  // Returned so the caller can put the grave into `boardsMetaAtom` rather than
  // dropping the entry. A missing entry makes `save` a no-op, which looks like
  // the same thing and is not: the board's debounced save can already be in
  // flight, and it reads the atom when the timer fires. Dropping the key means
  // that save writes nothing; keeping the grave means it writes the grave. Only
  // the second is true whichever order they land in.
  return metaOf(grave);
}

/**
 * The placeholder that was thrown away, so the screen standing on it can move.
 *
 * Not a grave and not a deletion: this board was never anywhere but here, so
 * there is nothing to tell anyone about (D79).
 */
export const discardedPlaceholderAtom = atom<string | null>(null);

/**
 * Removes an untouched board from this device, record and all.
 *
 * The one place in the app that deletes a board outright rather than burying
 * it. It is safe here for exactly one reason: a placeholder has never been
 * uploaded, so there is no remote copy for the reconcile pass to hand back —
 * which is the whole reason `removeBoard` writes a grave instead (D66). Using
 * this on a board the remote has seen would resurrect it on the next round.
 *
 * The metadata goes first. `useBoardPersistence` reads it before every write
 * and skips the write when it is gone, so clearing it closes the window where
 * a debounced save lands after the delete and puts the record straight back.
 */
export const discardPlaceholderAtom = atom(
  null,
  (get, set, boardId: string) => {
    const remaining = { ...get(boardsMetaAtom) };
    delete remaining[boardId];
    set(boardsMetaAtom, remaining);
    void deleteBoard(boardId);
    announce({ kind: "boards" });
    set(discardedPlaceholderAtom, boardId);
  },
);

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
 * The whole stored record for a board, assembled from the atoms.
 *
 * Exists because writing one by hand is a way to forget a field, and the field
 * that got forgotten was `tombstones`. `StoredBoard` has it optional, so
 * leaving it out type-checks — and renaming a board therefore erased the record
 * of every node ever deleted on it. The next sync then saw those nodes on the
 * remote with nothing to say they had been deleted, and brought them all back.
 *
 * Every writer that replaces a record goes through here, so the next field
 * added to a board cannot be dropped by one caller out of three.
 */
function recordFor(get: <T>(a: Atom<T>) => T, meta: BoardMeta): StoredBoard {
  return {
    ...meta,
    nodes: get(boardNodesAtom)[meta.id] ?? [],
    tombstones: get(tombstonesAtom)[meta.id] ?? [],
    viewport: get(viewportsAtom)[meta.id] ?? IDENTITY_VIEWPORT,
  };
}

/** Writes a board record and tells the other tabs it moved. */
function writeBoard(record: StoredBoard): void {
  void putBoard(record);
  announce({ kind: "board", boardId: record.id, updatedAt: record.updatedAt });
}

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
    incoming: {
      name: string;
      createdAt: number;
      updatedAt: number;
      /** Absent means alive — including "no longer deleted", after a revive. */
      deletedAt?: number;
    },
  ) => {
    const meta = get(boardsMetaAtom)[boardId];
    if (
      !meta ||
      (meta.name === incoming.name &&
        meta.createdAt === incoming.createdAt &&
        meta.updatedAt === incoming.updatedAt &&
        meta.deletedAt === incoming.deletedAt)
    ) {
      return;
    }
    // Rebuilt rather than spread over the old metadata: a merge that decided
    // the board is alive again says so by *not* carrying a `deletedAt`, and
    // spreading would leave the old one in place — a board revived on one
    // device and still buried on this one, disagreeing forever.
    const next: BoardMeta = {
      ...meta,
      name: incoming.name,
      createdAt: incoming.createdAt,
      updatedAt: incoming.updatedAt,
    };
    delete next.deletedAt;
    if (incoming.deletedAt !== undefined) {
      next.deletedAt = incoming.deletedAt;
    }
    set(boardsMetaAtom, { ...get(boardsMetaAtom), [boardId]: next });
    writeBoard(recordFor(get, next));
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
    writeBoard(recordFor(get, next));
  },
);
