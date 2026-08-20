import { atom } from "jotai";

export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /**
   * When this board was deleted, if it was (D66).
   *
   * Carried on the metadata rather than looked up, because every writer that
   * replaces a stored board builds its record by spreading a `BoardMeta` — so
   * a field that lives here is carried by all of them, and a field that does
   * not is dropped by all of them. Node tombstones learned that the hard way:
   * they were assembled by hand in three places and one of them forgot, which
   * quietly resurrected every node ever deleted on a renamed board.
   */
  deletedAt?: number;
}

/** Board metadata for the Home list, mirrored from IndexedDB. */
export const boardsMetaAtom = atom<Record<string, BoardMeta>>({});
