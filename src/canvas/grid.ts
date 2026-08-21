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

export function gridStyle(viewport: Viewport): CSSProperties {
  const size = GRID_SPACING * viewport.scale;
  return {
    backgroundImage:
      "radial-gradient(circle, var(--color-neutral-800) 1px, transparent 1px)",
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${viewport.tx}px ${viewport.ty}px`,
    opacity: size < GRID_FADE_BELOW ? 0 : 1,
  };
}

/** The same values, straight onto the elements. */
export function paintViewport(
  scene: HTMLElement | null,
  grid: HTMLElement | null,
  viewport: Viewport,
): void {
  if (scene) {
    scene.style.transform = sceneTransform(viewport);
  }
  if (grid) {
    const size = GRID_SPACING * viewport.scale;
    grid.style.backgroundSize = `${size}px ${size}px`;
    grid.style.backgroundPosition = `${viewport.tx}px ${viewport.ty}px`;
    grid.style.opacity = size < GRID_FADE_BELOW ? "0" : "1";
  }
}
