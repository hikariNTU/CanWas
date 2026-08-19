import { useAtom } from "jotai";
import { useCallback, useEffect, type RefObject } from "react";

import {
  IDENTITY_VIEWPORT,
  panBy,
  zoomByFactor,
  type Point,
  type Viewport,
} from "@/canvas/coords";
import { readViewport, viewportsAtom } from "@/canvas/viewport-atom";

const KEYBOARD_ZOOM_STEP = 1.2;

/**
 * Zoom-per-wheel-event tuning.
 *
 * The same `ctrlKey + wheel` signal arrives from two very different devices: a
 * trackpad pinch sends a stream of small deltas (~1-5), while a mouse sends one
 * large delta per notch (100-240). Applying one exponential to both makes a
 * single mouse notch jump the full zoom range. Clamping the delta first keeps
 * pinch smooth and caps a mouse notch at a sane step.
 */
const ZOOM_SENSITIVITY = 0.005;
const MAX_ZOOM_DELTA = 50;

function zoomFactorFromWheel(deltaY: number): number {
  const clamped = Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, deltaY));
  return Math.exp(-clamped * ZOOM_SENSITIVITY);
}

interface ViewportControls {
  viewport: Viewport;
  resetViewport: () => void;
  zoomFromCenter: (factor: number) => void;
}

/**
 * Wires pan and zoom onto `elementRef`. Wheel and pointer listeners are
 * attached natively rather than through React props because the wheel handler
 * must call `preventDefault`, which requires a non-passive listener.
 */
export function useViewportControls(
  boardId: string,
  elementRef: RefObject<HTMLElement | null>,
): ViewportControls {
  const [viewports, setViewports] = useAtom(viewportsAtom);
  const viewport = readViewport(viewports, boardId);

  const setViewport = useCallback(
    (update: Viewport | ((current: Viewport) => Viewport)) => {
      setViewports((previous) => {
        const current = readViewport(previous, boardId);
        const next = typeof update === "function" ? update(current) : update;
        return next === current ? previous : { ...previous, [boardId]: next };
      });
    },
    [boardId, setViewports],
  );

  // Every update goes through the functional setter. That keeps the native
  // listeners independent of the current viewport, so they are attached once
  // instead of being torn down and re-attached on every frame of a pan — which
  // would drop pointer events mid-gesture.

  const anchorFromEvent = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = elementRef.current?.getBoundingClientRect();
      return {
        x: event.clientX - (rect?.left ?? 0),
        y: event.clientY - (rect?.top ?? 0),
      };
    },
    [elementRef],
  );

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    function handleWheel(event: WheelEvent) {
      // Both branches preventDefault: pinch-zoom would otherwise zoom the page,
      // and two-finger pan would otherwise scroll it.
      event.preventDefault();

      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        const factor = zoomFactorFromWheel(event.deltaY);
        const anchor = anchorFromEvent(event);
        setViewport((current) => zoomByFactor(current, anchor, factor));
        return;
      }

      const { deltaX, deltaY } = event;
      setViewport((current) => panBy(current, -deltaX, -deltaY));
    }

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [elementRef, setViewport, anchorFromEvent]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    let panningPointerId: number | null = null;
    let last: Point = { x: 0, y: 0 };

    function handlePointerDown(event: PointerEvent) {
      const isPanButton = event.button === 0 || event.button === 1;
      if (!isPanButton || panningPointerId !== null) {
        return;
      }
      // A left press that landed on a node is a node drag, not a pan.
      //
      // The node's own handler cannot prevent this by calling stopPropagation:
      // React delegates events to the root container, so this native listener
      // on an ancestor runs first, during real DOM propagation. The ownership
      // test has to live here. Middle-drag still pans from anywhere.
      if (
        event.button === 0 &&
        (event.target as Element | null)?.closest?.("[data-node-id]")
      ) {
        return;
      }
      panningPointerId = event.pointerId;
      last = { x: event.clientX, y: event.clientY };
      element!.setPointerCapture(event.pointerId);
      element!.style.cursor = "grabbing";
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerId !== panningPointerId) {
        return;
      }
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last = { x: event.clientX, y: event.clientY };
      setViewport((current) => panBy(current, dx, dy));
    }

    function endPan(event: PointerEvent) {
      if (event.pointerId !== panningPointerId) {
        return;
      }
      panningPointerId = null;
      element!.style.cursor = "";
      if (element!.hasPointerCapture(event.pointerId)) {
        element!.releasePointerCapture(event.pointerId);
      }
    }

    element.addEventListener("pointerdown", handlePointerDown);
    element.addEventListener("pointermove", handlePointerMove);
    element.addEventListener("pointerup", endPan);
    element.addEventListener("pointercancel", endPan);
    return () => {
      element.removeEventListener("pointerdown", handlePointerDown);
      element.removeEventListener("pointermove", handlePointerMove);
      element.removeEventListener("pointerup", endPan);
      element.removeEventListener("pointercancel", endPan);
    };
  }, [elementRef, setViewport]);

  const zoomFromCenter = useCallback(
    (factor: number) => {
      const rect = elementRef.current?.getBoundingClientRect();
      const center: Point = {
        x: (rect?.width ?? 0) / 2,
        y: (rect?.height ?? 0) / 2,
      };
      setViewport((current) => zoomByFactor(current, center, factor));
    },
    [elementRef, setViewport],
  );

  const resetViewport = useCallback(
    () => setViewport(IDENTITY_VIEWPORT),
    [setViewport],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetViewport();
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomFromCenter(KEYBOARD_ZOOM_STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomFromCenter(1 / KEYBOARD_ZOOM_STEP);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetViewport, zoomFromCenter]);

  return { viewport, resetViewport, zoomFromCenter };
}
