import { useRef } from "react";

import { useViewportControls } from "@/canvas/use-viewport-controls";
import { useTranslation } from "@/translations";

const GRID_SPACING = 24;

export function Canvas({ boardId }: { boardId: string }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { viewport, resetViewport, zoomFromCenter } = useViewportControls(
    boardId,
    surfaceRef,
  );
  const { t } = useTranslation();

  const gridSize = GRID_SPACING * viewport.scale;

  return (
    <div className="relative h-full overflow-hidden">
      <div
        ref={surfaceRef}
        data-testid="canvas-surface"
        className="absolute inset-0 cursor-grab touch-none bg-neutral-950"
        style={{
          // The dot grid lives on the surface, not the scene, so it can tile
          // infinitely instead of being clipped to a finite element. Sizing it
          // by scale and offsetting it by the translation reproduces the same
          // parallax the scene has.
          backgroundImage:
            "radial-gradient(circle, var(--color-neutral-800) 1px, transparent 1px)",
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${viewport.tx}px ${viewport.ty}px`,
          opacity: gridSize < 6 ? 0 : 1,
        }}
      >
        <div
          data-testid="canvas-scene"
          className="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`,
          }}
        >
          {/* World origin marker. Nodes render here from step 3. */}
          <div
            aria-hidden
            data-testid="world-origin"
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-700"
          />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-3">
        <p className="text-xs text-neutral-600">{t("canvas.hint")}</p>
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/90 p-1 backdrop-blur">
          <button
            type="button"
            aria-label={t("canvas.zoomOut")}
            onClick={() => zoomFromCenter(1 / 1.2)}
            className="h-8 w-8 rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          >
            −
          </button>
          <button
            type="button"
            data-testid="zoom-reset"
            aria-label={t("canvas.resetView")}
            onClick={resetViewport}
            className="h-8 min-w-16 rounded-md px-2 font-mono text-xs text-neutral-300 tabular-nums transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button
            type="button"
            aria-label={t("canvas.zoomIn")}
            onClick={() => zoomFromCenter(1.2)}
            className="h-8 w-8 rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
