import { useStore } from "jotai";
import {
  useCallback,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useBoardHistory, useSelection } from "@/board/history";
import { moveNodes, resizeNode } from "@/board/mutations";
import type { Rect } from "@/board/patch";
import { boardNodesAtom } from "@/board/store";
import type { BoardNode, NodeId } from "@/board/types";
import type { Viewport } from "@/canvas/coords";

/** World units. Stops a resize from collapsing a node to nothing. */
const MIN_NODE_SIZE = 16;

/**
 * Live gesture state, deliberately outside the board store.
 *
 * A drag renders from this overlay rather than writing on every pointermove, so
 * the store changes exactly once per gesture — the granularity the history
 * stack wants (D17). An abandoned gesture needs no cleanup either, since the
 * store was never touched.
 */
type Gesture =
  | { kind: "move"; ids: NodeId[]; dx: number; dy: number }
  | { kind: "resize"; id: NodeId; rect: Rect }
  | null;

export function useNodeGestures(boardId: string, viewport: Viewport) {
  const store = useStore();
  const { commit } = useBoardHistory(boardId);
  const { selection, setSelection, toggle } = useSelection(boardId);
  const [gesture, setGesture] = useState<Gesture>(null);

  /**
   * Geometry is read from the store at pointerdown, never from a render-time
   * prop. Starting a gesture before React has re-rendered from the previous one
   * would otherwise anchor it to stale coordinates, and the node would jump.
   */
  const currentNode = useCallback(
    (id: NodeId): BoardNode | undefined =>
      (store.get(boardNodesAtom)[boardId] ?? []).find((node) => node.id === id),
    [boardId, store],
  );

  const startMove = useCallback(
    (event: ReactPointerEvent, nodeId: NodeId) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();

      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      const alreadySelected = selection.includes(nodeId);
      if (!alreadySelected || additive) {
        toggle(nodeId, additive);
      }
      const ids =
        additive || !alreadySelected
          ? Array.from(new Set([...(additive ? selection : []), nodeId]))
          : selection;

      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      const origin = { x: event.clientX, y: event.clientY };
      setGesture({ kind: "move", ids, dx: 0, dy: 0 });

      const delta = (point: { clientX: number; clientY: number }) => ({
        dx: (point.clientX - origin.x) / viewport.scale,
        dy: (point.clientY - origin.y) / viewport.scale,
      });

      const handleMove = (move: globalThis.PointerEvent) =>
        setGesture({ kind: "move", ids, ...delta(move) });

      const handleUp = (up: globalThis.PointerEvent) => {
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        target.removeEventListener("pointercancel", handleUp);
        const { dx, dy } = delta(up);
        setGesture(null);
        // A click is a drag of zero distance: it selects but records nothing.
        if (dx !== 0 || dy !== 0) {
          commit((nodes) => moveNodes(nodes, ids, dx, dy));
        }
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
      target.addEventListener("pointercancel", handleUp);
    },
    [commit, selection, toggle, viewport.scale],
  );

  const startResize = useCallback(
    (event: ReactPointerEvent, nodeId: NodeId) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();

      const base = currentNode(nodeId);
      if (!base) {
        return;
      }

      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      const origin = { x: event.clientX, y: event.clientY };
      const aspect = base.w / base.h;

      const rectFrom = (clientX: number, clientY: number): Rect => {
        // Driven by whichever axis moved further, then aspect-locked. Images
        // have one true aspect ratio; free resize would only ever distort them.
        const dx = (clientX - origin.x) / viewport.scale;
        const dy = (clientY - origin.y) / viewport.scale;
        const w = Math.max(MIN_NODE_SIZE, base.w + Math.max(dx, dy * aspect));
        return { x: base.x, y: base.y, w, h: w / aspect };
      };

      setGesture({
        kind: "resize",
        id: nodeId,
        rect: rectFrom(origin.x, origin.y),
      });

      const handleMove = (move: globalThis.PointerEvent) =>
        setGesture({
          kind: "resize",
          id: nodeId,
          rect: rectFrom(move.clientX, move.clientY),
        });

      const handleUp = (up: globalThis.PointerEvent) => {
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        target.removeEventListener("pointercancel", handleUp);
        const rect = rectFrom(up.clientX, up.clientY);
        setGesture(null);
        if (rect.w !== base.w) {
          commit((nodes) => resizeNode(nodes, nodeId, rect));
        }
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
      target.addEventListener("pointercancel", handleUp);
    },
    [commit, currentNode, viewport.scale],
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
