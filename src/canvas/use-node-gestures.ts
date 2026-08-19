import { useStore } from "jotai";
import {
  useCallback,
  useRef,
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
  const activeRef = useRef(false);

  /**
   * Starts a pointer gesture and guarantees it ends exactly once.
   *
   * Listeners go on `window`, not on the element that was pressed. An element
   * listener stops firing the moment its node unmounts or loses pointer
   * capture, and a gesture that never receives its `pointerup` leaves the
   * render overlay stuck: the node keeps drawing at gesture geometry until some
   * later commit clears the overlay, at which point it snaps back to whatever
   * the store still held.
   *
   * `pointercancel` aborts rather than commits. The event carries no meaningful
   * final position, so committing from it writes a wrong rectangle.
   */
  const beginGesture = useCallback(
    (
      event: ReactPointerEvent,
      handlers: {
        onMove: (event: globalThis.PointerEvent) => void;
        onCommit: (event: globalThis.PointerEvent) => void;
      },
    ): boolean => {
      if (activeRef.current) {
        return false;
      }
      activeRef.current = true;

      const { pointerId } = event;
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(pointerId);

      const finish = () => {
        activeRef.current = false;
        setGesture(null);
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
      };

      function handleMove(move: globalThis.PointerEvent) {
        if (move.pointerId === pointerId) {
          handlers.onMove(move);
        }
      }
      function handleUp(up: globalThis.PointerEvent) {
        if (up.pointerId !== pointerId) {
          return;
        }
        finish();
        handlers.onCommit(up);
      }
      function handleCancel(cancel: globalThis.PointerEvent) {
        if (cancel.pointerId === pointerId) {
          finish();
        }
      }

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
      return true;
    },
    [],
  );

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

      const origin = { x: event.clientX, y: event.clientY };
      const delta = (point: { clientX: number; clientY: number }) => ({
        dx: (point.clientX - origin.x) / viewport.scale,
        dy: (point.clientY - origin.y) / viewport.scale,
      });

      const started = beginGesture(event, {
        onMove: (move) => setGesture({ kind: "move", ids, ...delta(move) }),
        onCommit: (up) => {
          const { dx, dy } = delta(up);
          // A click is a drag of zero distance: it selects but records nothing.
          if (dx !== 0 || dy !== 0) {
            commit((nodes) => moveNodes(nodes, ids, dx, dy));
          }
        },
      });
      if (started) {
        setGesture({ kind: "move", ids, dx: 0, dy: 0 });
      }
    },
    [beginGesture, commit, selection, toggle, viewport.scale],
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

      const origin = { x: event.clientX, y: event.clientY };
      const aspect = base.w / base.h;

      const rectFrom = (clientX: number, clientY: number): Rect => {
        const dx = (clientX - origin.x) / viewport.scale;
        const dy = (clientY - origin.y) / viewport.scale;

        // Text resizes on one axis: `w` is its wrap width and its height
        // follows from how the text lays out. Dragging height would either be
        // ignored or clip the content.
        if (base.kind === "text") {
          return {
            x: base.x,
            y: base.y,
            w: Math.max(MIN_NODE_SIZE, base.w + dx),
            h: base.h,
          };
        }

        // Images resize on whichever axis moved further, aspect-locked: they
        // have one true ratio, so a free resize could only distort them.
        const w = Math.max(MIN_NODE_SIZE, base.w + Math.max(dx, dy * aspect));
        return { x: base.x, y: base.y, w, h: w / aspect };
      };

      const started = beginGesture(event, {
        onMove: (move) =>
          setGesture({
            kind: "resize",
            id: nodeId,
            rect: rectFrom(move.clientX, move.clientY),
          }),
        onCommit: (up) => {
          const rect = rectFrom(up.clientX, up.clientY);
          if (rect.w !== base.w) {
            commit((nodes) => resizeNode(nodes, nodeId, rect));
          }
        },
      });
      if (started) {
        setGesture({
          kind: "resize",
          id: nodeId,
          rect: rectFrom(origin.x, origin.y),
        });
      }
    },
    [beginGesture, commit, currentNode, viewport.scale],
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
