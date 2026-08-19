import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { useBoardHistory } from "@/board/history";
import { assetsAtom, boardNodesAtom, readNodes } from "@/board/store";
import { useBoardShortcuts } from "@/board/use-board-shortcuts";
import { useIngest } from "@/board/use-ingest";
import { useNodeGestures } from "@/canvas/use-node-gestures";
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

  const nodes = readNodes(useAtomValue(boardNodesAtom), boardId);
  const assets = useAtomValue(assetsAtom);
  const { undo, redo, canUndo, canRedo } = useBoardHistory(boardId);
  const { selection, setSelection, startMove, startResize, rectFor } =
    useNodeGestures(boardId, nodes, viewport);

  useIngest({ boardId, viewport, surfaceRef, nodes });
  useBoardShortcuts(boardId, nodes);

  // A press on empty canvas clears the selection. Registered natively so it
  // runs before the pan handler claims the pointer.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (
        event.target === surface ||
        event.target === surface?.firstElementChild
      ) {
        setSelection([]);
      }
    }
    surface.addEventListener("pointerdown", handlePointerDown);
    return () => surface.removeEventListener("pointerdown", handlePointerDown);
  }, [setSelection]);

  const gridSize = GRID_SPACING * viewport.scale;
  // Selection chrome is drawn in world space, so it must be divided by the
  // zoom to keep a constant thickness on screen.
  const hairline = 2 / viewport.scale;

  return (
    <div className="relative h-full overflow-hidden">
      <div
        ref={surfaceRef}
        data-testid="canvas-surface"
        className="absolute inset-0 cursor-grab touch-none bg-neutral-950"
        style={{
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
          <div
            aria-hidden
            data-testid="world-origin"
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-700"
          />
          {nodes.map((node) => {
            const asset = assets[node.assetId];
            if (!asset) {
              return null;
            }
            const rect = rectFor(node);
            const isSelected = selection.includes(node.id);
            return (
              <div
                key={node.id}
                data-testid="board-node"
                data-node-id={node.id}
                data-selected={isSelected || undefined}
                onPointerDown={(event) => startMove(event, node)}
                className="absolute cursor-move"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.w,
                  height: rect.h,
                  outline: isSelected
                    ? `${hairline}px solid var(--color-sky-500)`
                    : undefined,
                }}
              >
                <img
                  src={asset.url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none block h-full w-full select-none"
                />
                {isSelected && selection.length === 1 && (
                  <div
                    data-testid="resize-handle"
                    onPointerDown={(event) => startResize(event, node)}
                    className="absolute cursor-nwse-resize bg-sky-500"
                    style={{
                      width: hairline * 5,
                      height: hairline * 5,
                      right: -hairline * 2.5,
                      bottom: -hairline * 2.5,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-3">
        <p className="text-xs text-neutral-600">
          {nodes.length === 0 ? t("canvas.empty") : t("canvas.hint")}
        </p>
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/90 p-1 backdrop-blur">
          <ToolButton
            label={t("canvas.undo")}
            testId="undo"
            onClick={undo}
            disabled={!canUndo}
          >
            ↺
          </ToolButton>
          <ToolButton
            label={t("canvas.redo")}
            testId="redo"
            onClick={redo}
            disabled={!canRedo}
          >
            ↻
          </ToolButton>
          <span className="mx-1 h-5 w-px bg-neutral-800" />
          <ToolButton
            label={t("canvas.zoomOut")}
            onClick={() => zoomFromCenter(1 / 1.2)}
          >
            −
          </ToolButton>
          <button
            type="button"
            data-testid="zoom-reset"
            aria-label={t("canvas.resetView")}
            onClick={resetViewport}
            className="h-8 min-w-16 rounded-md px-2 font-mono text-xs text-neutral-300 tabular-nums transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <ToolButton
            label={t("canvas.zoomIn")}
            onClick={() => zoomFromCenter(1.2)}
          >
            +
          </ToolButton>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  testId,
  onClick,
  disabled,
  children,
}: {
  label: string;
  testId?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
