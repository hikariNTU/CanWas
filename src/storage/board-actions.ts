import { atom } from "jotai";

import { boardNodesAtom } from "@/board/store";
import { IDENTITY_VIEWPORT } from "@/canvas/coords";
import { viewportsAtom } from "@/canvas/viewport-atom";
import { boardsMetaAtom } from "@/storage/boards-atom";
import { putBoard } from "@/storage/db";

/**
 * Renaming is not undoable — the history stack covers board content only
 * (D17) — so it writes straight through rather than going via `commit`.
 *
 * Nodes and viewport are read from the store at write time, never captured
 * (D26): `putBoard` replaces the whole record, so writing a stale list here
 * would silently discard content.
 */
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
