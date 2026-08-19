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
