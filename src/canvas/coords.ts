/**
 * The three coordinate spaces are defined in docs/domain-model.md. This module
 * owns the only conversions between them, and holds no React and no state so it
 * stays trivially reasonable about.
 */

export interface Viewport {
  /** World-space translation, in screen pixels. */
  tx: number;
  ty: number;
  /** Zoom factor. */
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export const IDENTITY_VIEWPORT: Viewport = { tx: 0, ty: 0, scale: 1 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function worldToScreen(world: Point, viewport: Viewport): Point {
  return {
    x: world.x * viewport.scale + viewport.tx,
    y: world.y * viewport.scale + viewport.ty,
  };
}

export function screenToWorld(screen: Point, viewport: Viewport): Point {
  return {
    x: (screen.x - viewport.tx) / viewport.scale,
    y: (screen.y - viewport.ty) / viewport.scale,
  };
}

/** Pan by a screen-pixel delta. Scale is untouched. */
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, tx: viewport.tx + dx, ty: viewport.ty + dy };
}

/**
 * Zoom so that `anchor` — a point in SCREEN space, normally the cursor — keeps
 * pointing at the same world coordinate it did before. Without the anchor the
 * canvas appears to drift away from the pointer as you zoom.
 */
export function zoomAt(
  viewport: Viewport,
  anchor: Point,
  nextScaleRaw: number,
): Viewport {
  const scale = clampScale(nextScaleRaw);
  if (scale === viewport.scale) {
    return viewport;
  }
  const world = screenToWorld(anchor, viewport);
  return {
    scale,
    tx: anchor.x - world.x * scale,
    ty: anchor.y - world.y * scale,
  };
}

/** Multiply the current zoom, anchored at a screen point. */
export function zoomByFactor(
  viewport: Viewport,
  anchor: Point,
  factor: number,
): Viewport {
  return zoomAt(viewport, anchor, viewport.scale * factor);
}

/** A world-space box. Structural, so `board/patch`'s `Rect` satisfies it. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewSize {
  width: number;
  height: number;
}

/** How much of the view a fitted box is allowed to fill. */
const FIT_MARGIN = 0.9;

/** Is every corner of `box` currently on screen? */
export function boxFitsIn(
  box: Box,
  viewport: Viewport,
  view: ViewSize,
): boolean {
  const topLeft = worldToScreen({ x: box.x, y: box.y }, viewport);
  const bottomRight = worldToScreen(
    { x: box.x + box.w, y: box.y + box.h },
    viewport,
  );
  return (
    topLeft.x >= 0 &&
    topLeft.y >= 0 &&
    bottomRight.x <= view.width &&
    bottomRight.y <= view.height
  );
}

/**
 * A viewport that centres `box` and leaves it filling ~90% of the view.
 *
 * The board is not touched: node geometry stays at its own pixel size (D59),
 * and only the view moves (D71). That is what keeps two screenshots of the
 * same screen comparable — the thing scaling a paste to the window destroys —
 * while still landing a 4000px capture on a phone whole.
 *
 * Never zooms further in than the view already is. A batch can fail to fit by
 * being off to one side rather than by being large, and magnifying a small
 * image because it was out of frame is not what "fit" means to anyone.
 */
export function fitBox(box: Box, viewport: Viewport, view: ViewSize): Viewport {
  if (box.w <= 0 || box.h <= 0 || view.width <= 0 || view.height <= 0) {
    return viewport;
  }
  const scale = clampScale(
    Math.min(
      (view.width * FIT_MARGIN) / box.w,
      (view.height * FIT_MARGIN) / box.h,
      viewport.scale,
    ),
  );
  return {
    scale,
    tx: view.width / 2 - (box.x + box.w / 2) * scale,
    ty: view.height / 2 - (box.y + box.h / 2) * scale,
  };
}
