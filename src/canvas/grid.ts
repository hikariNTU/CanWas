import type { CSSProperties } from "react";

import type { Viewport } from "@/canvas/coords";

/** World units between dots. */
export const GRID_SPACING = 24;
/** Below this on-screen dot spacing the grid reads as noise, so it fades out. */
export const GRID_FADE_BELOW = 6;

/**
 * The scene's transform and the grid's backing style, in one place.
 *
 * Both are written twice: by React on every committed viewport, and directly
 * on the DOM during a gesture, where the whole point is not to render (D77).
 * Two spellings of the same string would drift, and the drift would show as a
 * one-frame jump at the end of every pan.
 */
export function sceneTransform(viewport: Viewport): string {
  return `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`;
}

/**
 * How far the grid layer overhangs the surface on every side, in CSS pixels.
 *
 * A gesture slides the layer by up to one tile (see `paintViewport`), and a
 * tile is at most `GRID_SPACING * MAX_SCALE` across. The overhang is what it
 * slides into; without it the top-left edge of the layer would walk into view.
 * The class that spells this in Tailwind is on the element in `canvas.tsx`.
 */
export const GRID_MARGIN = GRID_SPACING * 8;

export function gridStyle(viewport: Viewport): CSSProperties {
  const size = GRID_SPACING * viewport.scale;
  return {
    backgroundImage:
      "radial-gradient(circle, var(--color-neutral-800) 1px, transparent 1px)",
    backgroundSize: `${size}px ${size}px`,
    // The overhang shifts the layer's origin, so it is added back here to keep
    // a dot on the world origin.
    backgroundPosition: `${viewport.tx + GRID_MARGIN}px ${viewport.ty + GRID_MARGIN}px`,
    transform: "none",
    opacity: size < GRID_FADE_BELOW ? 0 : 1,
  };
}

/** `value` folded into `[0, period)`, so a pan never travels further than a tile. */
function wrap(value: number, period: number): number {
  return period > 0 ? ((value % period) + period) % period : 0;
}

/**
 * The same values, straight onto the elements.
 *
 * `base` is the viewport the grid layer was last painted at — the committed
 * one. When only the translation has moved since, the grid is panned with a
 * transform instead of by rewriting its background.
 *
 * That is not an optimisation, it is the difference between a grid that sticks
 * to the board and one that does not. iOS rounds `background-position` to whole
 * device pixels; a transform is interpolated at subpixel precision, like the
 * scene's own. At a fractional zoom the two disagree by up to a pixel, and
 * which way they round changes as the board moves, so the dots visibly crawl
 * against the images they are supposed to sit behind.
 *
 * The pattern repeats every tile, so sliding the layer by the pan modulo one
 * tile is indistinguishable from sliding it by the whole pan, and keeps the
 * travel inside `GRID_MARGIN`.
 */
export function paintViewport(
  scene: HTMLElement | null,
  grid: HTMLElement | null,
  viewport: Viewport,
  base?: Viewport,
): void {
  if (scene) {
    scene.style.transform = sceneTransform(viewport);
  }
  if (!grid) {
    return;
  }
  const size = GRID_SPACING * viewport.scale;
  if (base && base.scale === viewport.scale) {
    // Same zoom, so the background already on the layer is the right size and
    // the right opacity. Only where it sits has changed.
    const dx = wrap(viewport.tx - base.tx, size);
    const dy = wrap(viewport.ty - base.ty, size);
    grid.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    return;
  }
  // A zoom repaints: the tile itself is a different size, which no transform on
  // a tiled background can express without also stretching the dots.
  grid.style.transform = "none";
  grid.style.backgroundSize = `${size}px ${size}px`;
  grid.style.backgroundPosition = `${viewport.tx + GRID_MARGIN}px ${viewport.ty + GRID_MARGIN}px`;
  grid.style.opacity = size < GRID_FADE_BELOW ? "0" : "1";
}
