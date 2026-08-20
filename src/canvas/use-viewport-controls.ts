import { useAtom } from "jotai";
import { useCallback, useEffect, type RefObject } from "react";

import {
  boxFitsIn,
  fitBox,
  IDENTITY_VIEWPORT,
  panBy,
  zoomByFactor,
  type Box,
  type Point,
  type Viewport,
} from "@/canvas/coords";
import { currentMode } from "@/canvas/canvas-mode";
import { isPanKeyDown } from "@/canvas/pan-key";
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
  fitIntoView: (box: Box) => void;
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

    // Live fingers, in the order they landed. Two of them is a pinch, and a
    // pinch outranks everything else a finger can be doing (D73).
    const touches = new Map<number, Point>();
    let pinching = false;
    let spread = 0;
    let middle: Point = { x: 0, y: 0 };

    function twoFingers(): [Point, Point] | null {
      const points = [...touches.values()];
      return points.length === 2 ? [points[0]!, points[1]!] : null;
    }

    function measure([a, b]: [Point, Point]) {
      return {
        spread: Math.hypot(b.x - a.x, b.y - a.y),
        middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }

    /**
     * Takes the gesture away from whatever claimed the first finger.
     *
     * A node drag, a lasso and a tap all start on the first `pointerdown` and
     * run on `window` listeners, so by the time the second finger lands one of
     * them is already moving something. They all abort on `pointercancel` —
     * the event the platform itself would send if the browser took the gesture
     * over for scrolling — so that is what they get. Cancelling is the right
     * word for it: a pinch that dragged an image halfway across the board on
     * the way to zooming would be worse than no pinch at all.
     */
    function stealFromOtherGestures() {
      if (panningPointerId !== null) {
        element!.style.cursor = "";
        if (element!.hasPointerCapture(panningPointerId)) {
          element!.releasePointerCapture(panningPointerId);
        }
        panningPointerId = null;
      }
      for (const id of touches.keys()) {
        window.dispatchEvent(
          new PointerEvent("pointercancel", { pointerId: id, bubbles: true }),
        );
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.pointerType === "touch") {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const pair = twoFingers();
        if (pair) {
          pinching = true;
          ({ spread, middle } = measure(pair));
          stealFromOtherGestures();
        }
        // A third finger neither pinches nor pans; it just joins the map, so
        // that lifting one of the first two does not restart a pan.
        if (touches.size > 1) {
          return;
        }
      }
      const isPanButton = event.button === 0 || event.button === 1;
      if (!isPanButton || panningPointerId !== null) {
        return;
      }
      // Who owns a left press.
      //
      // In pan mode the viewport owns every left press, node or not — that is
      // the whole point of the mode, since a screenshot wider than the screen
      // leaves no empty canvas to grab (D70). A tap that never travels is
      // handled elsewhere, by `useTapSelect`, so nodes stay selectable here.
      //
      // In select mode a left press never pans. It is a node drag on a node
      // and a lasso on empty canvas (D54); panning is the pan key, the middle
      // button, or the chip. A finger is included in that: it used to be
      // excluded so touch could always pan, but in select mode that made one
      // finger pan the board AND draw a marquee at the same time, since
      // `useLasso` had already claimed the same press.
      //
      // The node's own handler cannot prevent this by calling stopPropagation:
      // React delegates events to the root container, so this native listener
      // on an ancestor runs first, during real DOM propagation. The ownership
      // test has to live here. Middle-drag still pans from anywhere.
      if (event.button === 0 && currentMode() === "select" && !isPanKeyDown()) {
        return;
      }
      panningPointerId = event.pointerId;
      last = { x: event.clientX, y: event.clientY };
      element!.setPointerCapture(event.pointerId);
      element!.style.cursor = "grabbing";
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType === "touch" && touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const pair = pinching ? twoFingers() : null;
        if (pair) {
          const next = measure(pair);
          const factor = spread > 0 ? next.spread / spread : 1;
          const dx = next.middle.x - middle.x;
          const dy = next.middle.y - middle.y;
          const anchor = anchorFromEvent({
            clientX: next.middle.x,
            clientY: next.middle.y,
          });
          ({ spread, middle } = next);
          // Zoom about the point between the fingers and follow that point as
          // it travels, so a pinch pans and zooms in one movement — the two are
          // one gesture on a touch screen, and separating them makes the board
          // slide out from under the fingers.
          setViewport((current) =>
            panBy(zoomByFactor(current, anchor, factor), dx, dy),
          );
          return;
        }
      }
      if (event.pointerId !== panningPointerId) {
        return;
      }
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      last = { x: event.clientX, y: event.clientY };
      setViewport((current) => panBy(current, dx, dy));
    }

    function endPan(event: PointerEvent) {
      if (touches.delete(event.pointerId) && touches.size < 2) {
        // The pinch ends with the first finger to leave. The one still down is
        // deliberately not promoted to a pan: it has been sitting still while
        // the other did the moving, and handing it the board makes it jump.
        pinching = false;
      }
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
  }, [anchorFromEvent, elementRef, setViewport]);

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

  /**
   * Frames `box`, but only when it is not already fully on screen.
   *
   * The conditional is the whole design (D71): pasting a small image onto a
   * board being read must not yank the view, and only the case that is
   * actually broken — a capture larger than the window — causes motion.
   */
  const fitIntoView = useCallback(
    (box: Box) => {
      const rect = elementRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setViewport((current) =>
        boxFitsIn(box, current, rect) ? current : fitBox(box, current, rect),
      );
    },
    [elementRef, setViewport],
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

  return { viewport, resetViewport, zoomFromCenter, fitIntoView };
}
