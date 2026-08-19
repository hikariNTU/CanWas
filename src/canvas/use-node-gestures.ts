import {
  useCallback,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useBoardHistory, useSelection } from "@/board/history";
import { moveNodes, resizeNode } from "@/board/mutations";
import type { Rect } from "@/board/patch";
import type { BoardNode, NodeId } from "@/board/types";
import type { Viewport } from "@/canvas/coords";

/** World units. Stops a resize from collapsing a node to nothing. */
const MIN_NODE_SIZE = 16;

/**
 * Live gesture state, deliberately outside the board store.
 *
 * A drag renders from this overlay rather than writing to the store on every
 * pointermove, so the store only ever changes once per gesture — which is
 * exactly the granularity the history stack wants (D17). It also means an
 * abandoned gesture needs no cleanup: drop the overlay and the store was never
 * touched.
 */
type Gesture =
  | { kind: "move"; ids: NodeId[]; dx: number; dy: number }
  | { kind: "resize"; id: NodeId; rect: Rect }
  | null;

export function useNodeGestures(
  boardId: string,
  nodes: readonly BoardNode[],
  viewport: Viewport,
) {
  const { commit } = useBoardHistory(boardId);
  const { selection, toggle, setSelection } = useSelection(boardId);
  const [gesture, setGesture] = useState<Gesture>(null);

  const startMove = useCallback(
    (event: ReactPointerEvent, node: BoardNode) => {
      if (event.button !== 0) {
        return;
      }
      // Stop the canvas from reading this as a pan.
      event.stopPropagation();

      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const alreadySelected = selection.includes(node.id);
      if (!alreadySelected || additive) {
        toggle(node.id, additive);
      }
      const ids =
        additive || !alreadySelected
          ? Array.from(new Set([...(additive ? selection : []), node.id]))
          : selection;

      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      const origin = { x: event.clientX, y: event.clientY };
      setGesture({ kind: "move", ids, dx: 0, dy: 0 });

      const handleMove = (move: globalThis.PointerEvent) => {
        setGesture({
          kind: "move",
          ids,
          dx: (move.clientX - origin.x) / viewport.scale,
          dy: (move.clientY - origin.y) / viewport.scale,
        });
      };
      const handleUp = (up: globalThis.PointerEvent) => {
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        target.removeEventListener("pointercancel", handleUp);
        const dx = (up.clientX - origin.x) / viewport.scale;
        const dy = (up.clientY - origin.y) / viewport.scale;
        setGesture(null);
        // A click is a drag of zero distance; it selects but records nothing.
        if (dx !== 0 || dy !== 0) {
          commit(moveNodes(nodes, ids, dx, dy));
        }
      };
      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
      target.addEventListener("pointercancel", handleUp);
    },
    [commit, nodes, selection, toggle, viewport.scale],
  );

  const startResize = useCallback(
    (event: ReactPointerEvent, node: BoardNode) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);

      const origin = { x: event.clientX, y: event.clientY };
      const aspect = node.w / node.h;

      const rectFor = (clientX: number, clientY: number): Rect => {
        // Driven by whichever axis moved further, then aspect-locked. Images
        // have one true aspect ratio; free resize would only ever distort them.
        const dx = (clientX - origin.x) / viewport.scale;
        const dy = (clientY - origin.y) / viewport.scale;
        const w = Math.max(MIN_NODE_SIZE, node.w + Math.max(dx, dy * aspect));
        return { x: node.x, y: node.y, w, h: w / aspect };
      };

      setGesture({
        kind: "resize",
        id: node.id,
        rect: rectFor(origin.x, origin.y),
      });

      const handleMove = (move: globalThis.PointerEvent) => {
        setGesture({
          kind: "resize",
          id: node.id,
          rect: rectFor(move.clientX, move.clientY),
        });
      };
      const handleUp = (up: globalThis.PointerEvent) => {
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        target.removeEventListener("pointercancel", handleUp);
        const rect = rectFor(up.clientX, up.clientY);
        setGesture(null);
        if (rect.w !== node.w) {
          commit(resizeNode(nodes, node.id, rect));
        }
      };
      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
      target.addEventListener("pointercancel", handleUp);
    },
    [commit, nodes, viewport.scale],
  );

  /** Node geometry with the live gesture applied, for rendering only. */
  const rectFor = useCallback(
    (node: BoardNode): Rect => {
      if (gesture?.kind === "move" && gesture.ids.includes(node.id)) {
        return {
          x: node.x + gesture.dx,
          y: node.y + gesture.dy,
          w: node.w,
          h: node.h,
        };
      }
      if (gesture?.kind === "resize" && gesture.id === node.id) {
        return gesture.rect;
      }
      return { x: node.x, y: node.y, w: node.w, h: node.h };
    },
    [gesture],
  );

  return { selection, setSelection, startMove, startResize, rectFor };
}
