import { useStore } from "jotai";
import { useEffect, useState, type RefObject } from "react";

import { selectionAtom } from "@/board/history";
import type { Rect } from "@/board/patch";
import { boardNodesAtom } from "@/board/store";
import type { BoardNode, NodeId } from "@/board/types";
import { screenToWorld, type Viewport } from "@/canvas/coords";
import { currentMode } from "@/canvas/canvas-mode";
import { isPanKeyDown } from "@/canvas/pan-key";

/**
 * Screen pixels the pointer must travel before a press becomes a lasso.
 *
 * Without it every click on empty canvas would flash a zero-sized box, and a
 * click that drifts by one pixel — which is most clicks on a trackpad — would
 * be indistinguishable from a deliberate empty selection.
 */
const DRAG_THRESHOLD = 3;

/** Does the marquee touch this node at all? Contact selects; containment is not required. */
function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

function rectBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

function rectOf(node: BoardNode): Rect {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}

/**
 * Rubber-band selection: press empty canvas, drag, and every node the box
 * touches is selected.
 *
 * The returned rect is in world space and is for rendering only — it lives here
 * rather than in the board store because a marquee is not a board edit and must
 * never reach the history stack (D17).
 */
export function useLasso(
  boardId: string,
  viewport: Viewport,
  surfaceRef: RefObject<HTMLElement | null>,
): { lasso: Rect | null } {
  const store = useStore();
  const [lasso, setLasso] = useState<Rect | null>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      // A finger lassos only in select mode. In pan mode it has to keep
      // panning, because on a phone that is the only way to move around the
      // board at all — there is no second button and no space bar (D70).
      if (
        event.button !== 0 ||
        (event.pointerType === "touch" && currentMode() !== "select") ||
        isPanKeyDown() ||
        (event.target as Element | null)?.closest?.("[data-node-id]")
      ) {
        return;
      }

      const rect = surface!.getBoundingClientRect();
      const toWorld = (client: { clientX: number; clientY: number }) =>
        screenToWorld(
          { x: client.clientX - rect.left, y: client.clientY - rect.top },
          viewport,
        );

      const origin = toWorld(event);
      const start = { x: event.clientX, y: event.clientY };
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      // Read once, at the press: during the drag the selection is ours to
      // overwrite, so reading it again would compound with itself.
      const base: NodeId[] = additive
        ? (store.get(selectionAtom)[boardId] ?? [])
        : [];
      let live = false;

      function handleMove(move: PointerEvent) {
        if (
          !live &&
          Math.hypot(move.clientX - start.x, move.clientY - start.y) <
            DRAG_THRESHOLD
        ) {
          return;
        }
        live = true;

        const box = rectBetween(origin, toWorld(move));
        setLasso(box);

        const hits = (store.get(boardNodesAtom)[boardId] ?? [])
          .filter((node) => intersects(box, rectOf(node)))
          .map((node) => node.id);
        // Additive keeps what was already selected; a node inside the box that
        // was already selected stays selected rather than toggling off, so that
        // sweeping back and forth does not flicker.
        const next = additive ? Array.from(new Set([...base, ...hits])) : hits;
        store.set(selectionAtom, (previous) => ({
          ...previous,
          [boardId]: next,
        }));
      }

      function finish() {
        setLasso(null);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      }

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    }

    surface.addEventListener("pointerdown", handlePointerDown);
    return () => surface.removeEventListener("pointerdown", handlePointerDown);
  }, [boardId, store, surfaceRef, viewport]);

  return { lasso };
}
