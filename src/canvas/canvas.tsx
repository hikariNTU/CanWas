import { useAtomValue } from "jotai";
import { MinusIcon, PlusIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { useEffect, useRef } from "react";

import { useBoardHistory } from "@/board/history";
import { assetsAtom, boardNodesAtom, readNodes } from "@/board/store";
import { useBoardShortcuts } from "@/board/use-board-shortcuts";
import { useIngest } from "@/board/use-ingest";
import { BoardMenu } from "@/canvas/board-menu";
import { BoardName } from "@/canvas/board-name";
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
    useNodeGestures(boardId, viewport);

  useIngest({ boardId, viewport, surfaceRef, nodes });
  useBoardShortcuts(boardId);

  // A press on empty canvas clears the selection. Registered natively so it
  // runs before the pan handler claims the pointer.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (!(event.target as Element | null)?.closest?.("[data-node-id]")) {
        setSelection([]);
      }
    }
    surface.addEventListener("pointerdown", handlePointerDown);
    return () => surface.removeEventListener("pointerdown", handlePointerDown);
  }, [setSelection]);

  const gridSize = GRID_SPACING * viewport.scale;
  // Selection chrome is drawn in world space, so it is divided by the zoom to
  // keep a constant thickness on screen.
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
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-800"
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
                onPointerDown={(event) => startMove(event, node.id)}
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
                    onPointerDown={(event) => startResize(event, node.id)}
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

      {/* Chrome floats over the canvas and never reserves layout space, so the
          board reaches every edge of the window. */}
      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-1">
        <BoardMenu onResetView={resetViewport} />
        <BoardName boardId={boardId} />
      </div>

      {nodes.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-neutral-600">
          {t("canvas.empty")}
        </p>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2">
        <Island>
          <IconButton
            label={t("canvas.zoomOut")}
            onClick={() => zoomFromCenter(1 / 1.2)}
          >
            <MinusIcon size={16} />
          </IconButton>
          <button
            type="button"
            data-testid="zoom-reset"
            aria-label={t("canvas.resetView")}
            onClick={resetViewport}
            className="h-8 min-w-14 rounded-md px-2 font-mono text-xs text-neutral-300 tabular-nums transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <IconButton
            label={t("canvas.zoomIn")}
            onClick={() => zoomFromCenter(1.2)}
          >
            <PlusIcon size={16} />
          </IconButton>
        </Island>
        <Island>
          <IconButton
            label={t("canvas.undo")}
            testId="undo"
            onClick={undo}
            disabled={!canUndo}
          >
            <Undo2Icon size={16} />
          </IconButton>
          <IconButton
            label={t("canvas.redo")}
            testId="redo"
            onClick={redo}
            disabled={!canRedo}
          >
            <Redo2Icon size={16} />
          </IconButton>
        </Island>
      </div>
    </div>
  );
}

/** A floating chrome group. Excalidraw calls these islands; so do we. */
export function Island({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/90 p-1 shadow-lg backdrop-blur">
      {children}
    </div>
  );
}

function IconButton({
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
      className="grid h-8 w-8 place-items-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
