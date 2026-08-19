import clsx from "clsx";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { useBoardHistory, useSelection } from "@/board/history";
import {
  deleteNodes,
  insertNodes,
  setFontSize,
  setTextContent,
} from "@/board/mutations";
import {
  createTextNode,
  FONT_SIZES,
  MAX_TEXT_LENGTH,
  truncateText,
} from "@/board/text";
import type { NodeId } from "@/board/types";
import { assetsAtom, boardNodesAtom, readNodes } from "@/board/store";
import { useBoardShortcuts } from "@/board/use-board-shortcuts";
import { useIngest } from "@/board/use-ingest";
import { BoardMenu } from "@/canvas/board-menu";
import { BoardName } from "@/canvas/board-name";
import { measureHeight, TextNodeView } from "@/canvas/text-node";
import { Icon } from "@/ui/icon";
import { screenToWorld } from "@/canvas/coords";
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
  const { commit, undo, redo, canUndo, canRedo } = useBoardHistory(boardId);
  const { selection, setSelection, startMove, startResize, rectFor } =
    useNodeGestures(boardId, viewport);

  const [editingId, setEditingId] = useState<NodeId | null>(null);
  const [draft, setDraft] = useState("");
  const bodyRef = useRef<HTMLElement | null>(null);
  const { setSelection: select } = useSelection(boardId);

  const startEditing = useCallback((id: NodeId, text: string) => {
    setDraft(text);
    setEditingId(id);
  }, []);

  /**
   * Commits the draft and its measured height as one Change, or deletes the
   * node if nothing was typed — an empty text node is invisible and
   * unselectable, so leaving one behind would strand it on the board.
   */
  const finishEditing = useCallback(() => {
    const id = editingId;
    if (id === null) {
      return;
    }
    const height = measureHeight(bodyRef.current);
    const text = truncateText(draft);
    setEditingId(null);
    if (text.trim() === "") {
      commit((current) => deleteNodes(current, [id]));
      return;
    }
    commit((current) => setTextContent(current, id, text, height));
  }, [commit, draft, editingId]);

  // Double-clicking empty canvas starts a new text node where the pointer is.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    function handleDoubleClick(event: MouseEvent) {
      if ((event.target as Element | null)?.closest?.("[data-node-id]")) {
        return;
      }
      const rect = surface!.getBoundingClientRect();
      const world = screenToWorld(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        viewport,
      );
      const node = createTextNode(world.x, world.y);
      commit((current) => insertNodes(current, [node], "add text"));
      select([node.id]);
      startEditing(node.id, "");
    }
    surface.addEventListener("dblclick", handleDoubleClick);
    return () => surface.removeEventListener("dblclick", handleDoubleClick);
  }, [commit, select, startEditing, surfaceRef, viewport]);

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

  // The size control belongs to exactly one selected text node: with several,
  // it is unclear which the buttons would act on.
  const selectedText =
    selection.length === 1
      ? nodes.find((node) => node.id === selection[0] && node.kind === "text")
      : undefined;

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
            const rect = rectFor(node);
            const isSelected = selection.includes(node.id);
            const isEditing = editingId === node.id;
            const asset = node.kind === "image" ? assets[node.assetId] : null;
            if (node.kind === "image" && !asset) {
              return null;
            }
            return (
              <div
                key={node.id}
                data-testid="board-node"
                data-node-kind={node.kind}
                data-node-id={node.id}
                data-selected={isSelected || undefined}
                onPointerDown={(event) => {
                  if (!isEditing) {
                    startMove(event, node.id);
                  }
                }}
                onDoubleClick={() => {
                  if (node.kind === "text" && !isEditing) {
                    startEditing(node.id, node.text);
                  }
                }}
                className="absolute cursor-move"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.w,
                  // Text lays out at automatic height; only images are sized
                  // in both axes.
                  height: node.kind === "image" ? rect.h : undefined,
                  outline: isSelected
                    ? `${hairline}px solid var(--color-sky-500)`
                    : undefined,
                }}
              >
                {node.kind === "image" && asset ? (
                  <img
                    src={asset.url}
                    alt=""
                    draggable={false}
                    className="pointer-events-none block h-full w-full select-none"
                  />
                ) : node.kind === "text" ? (
                  <TextNodeView
                    node={isEditing ? { ...node, text: draft } : node}
                    editing={isEditing}
                    maxLength={MAX_TEXT_LENGTH}
                    onChange={setDraft}
                    onFinish={finishEditing}
                    bodyRef={bodyRef}
                  />
                ) : null}
                {isSelected && selection.length === 1 && !isEditing && (
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
        <BoardMenu boardId={boardId} onResetView={resetViewport} />
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
            <Icon name="remove" />
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
            <Icon name="add" />
          </IconButton>
        </Island>
        {selectedText?.kind === "text" && (
          <Island>
            {FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                data-testid={`font-size-${size}`}
                aria-label={t("text.size")}
                aria-pressed={selectedText.fontSize === size}
                onClick={() =>
                  commit((current) =>
                    setFontSize(current, selectedText.id, size),
                  )
                }
                className={clsx(
                  "grid h-8 w-8 place-items-center rounded-md transition-colors duration-150 hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none",
                  selectedText.fontSize === size
                    ? "bg-neutral-800 text-sky-400"
                    : "text-neutral-400 hover:text-neutral-100",
                )}
                style={{ fontSize: 8 + size / 4 }}
              >
                A
              </button>
            ))}
          </Island>
        )}
        <Island>
          <IconButton
            label={t("canvas.undo")}
            testId="undo"
            onClick={undo}
            disabled={!canUndo}
          >
            <Icon name="undo" />
          </IconButton>
          <IconButton
            label={t("canvas.redo")}
            testId="redo"
            onClick={redo}
            disabled={!canRedo}
          >
            <Icon name="redo" />
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
