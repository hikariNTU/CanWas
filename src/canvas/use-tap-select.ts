import { useEffect, type RefObject } from "react";

import type { NodeId } from "@/board/types";
import { currentMode } from "@/canvas/canvas-mode";

/**
 * Screen pixels a press may travel and still count as a tap.
 *
 * Larger than the lasso's 3px threshold on purpose: that one separates a
 * deliberate drag from trackpad jitter, this one separates a tap from a pan by
 * a finger, and a finger rolls further than a trackpad slips.
 */
const TAP_SLOP = 5;

/**
 * Tap-to-select, for pan mode only.
 *
 * In pan mode the viewport owns every press, so a node can no longer be
 * selected by pressing it — and without a selection there is nothing for the
 * delete button to act on, which on a touch device means images can be added
 * and never removed. A press that ends without travelling is not a pan by any
 * reading, so it is given back to the node underneath.
 *
 * Select mode does not come through here at all: there, pressing a node
 * already selects it as part of starting a drag.
 */
export function useTapSelect(
  surfaceRef: RefObject<HTMLElement | null>,
  select: (ids: NodeId[]) => void,
) {
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0 || currentMode() !== "pan") {
        return;
      }
      const start = { x: event.clientX, y: event.clientY };
      const nodeId = (event.target as Element | null)
        ?.closest?.("[data-node-id]")
        ?.getAttribute("data-node-id");

      function finish(up: PointerEvent) {
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        if (up.pointerId !== event.pointerId) {
          return;
        }
        if (Math.hypot(up.clientX - start.x, up.clientY - start.y) > TAP_SLOP) {
          return;
        }
        // A tap on empty canvas clears, the same as a click does in select
        // mode. Pressing empty canvas cannot clear on pointerdown here: that
        // press is usually the start of a pan, and a selection that vanished
        // the moment you moved the board would take the delete button with it.
        select(nodeId ? [nodeId as NodeId] : []);
      }
      function cancel() {
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
      }

      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
    }

    surface.addEventListener("pointerdown", handlePointerDown);
    return () => surface.removeEventListener("pointerdown", handlePointerDown);
  }, [select, surfaceRef]);
}
