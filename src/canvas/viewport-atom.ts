import { atom } from "jotai";

import { IDENTITY_VIEWPORT, type Viewport } from "@/canvas/coords";

/**
 * One viewport per board, keyed by board id.
 *
 * A record rather than jotai's `atomFamily`, which is deprecated in favour of
 * the separate `jotai-family` package — not worth a dependency for a lookup
 * this small. Only one board is open at a time, so the coarse invalidation a
 * single record atom causes costs nothing.
 *
 * Panning and zooming are view state: never undoable (docs/decisions.md D17)
 * and must not bump the board's `updatedAt` once persistence lands at step 5.
 */
export const viewportsAtom = atom<Record<string, Viewport>>({});

export function readViewport(
  viewports: Record<string, Viewport>,
  boardId: string,
): Viewport {
  return viewports[boardId] ?? IDENTITY_VIEWPORT;
}
