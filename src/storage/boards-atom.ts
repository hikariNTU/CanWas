import { atom } from "jotai";

export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** Board metadata for the Home list, mirrored from IndexedDB. */
export const boardsMetaAtom = atom<Record<string, BoardMeta>>({});
