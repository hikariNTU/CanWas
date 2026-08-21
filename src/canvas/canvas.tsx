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
import { About } from "@/canvas/about";
import { AddImage, TakePhoto } from "@/canvas/add-image";
import { measureHeight, TextNodeView } from "@/canvas/text-node";
import { NodeMenu } from "@/canvas/node-menu";
import { MissingAsset } from "@/canvas/missing-asset";
import { OcrBadge } from "@/canvas/ocr-badge";
import { OcrOverlay } from "@/canvas/ocr-overlay";
import { useOcr } from "@/ocr/use-ocr";
import { useCompression } from "@/image/use-compression";
import { ReconnectPill, SyncButton } from "@/sync/sync-button";
import { TipProvider } from "@/ui/tooltip";
import { useKnownRemote } from "@/sync/edit-guard";
import { StaleEditDialog } from "@/sync/stale-edit-dialog";
import { useSync } from "@/sync/use-sync";
import { Icon } from "@/ui/icon";
import { screenToWorld } from "@/canvas/coords";
import { currentMode } from "@/canvas/canvas-mode";
import { useCanvasMode } from "@/canvas/canvas-mode";
import { TouchBar } from "@/canvas/touch-controls";
import { useTapSelect } from "@/canvas/use-tap-select";
import { useLasso } from "@/canvas/use-lasso";
import { useNodeGestures } from "@/canvas/use-node-gestures";
import { gridStyle, sceneTransform } from "@/canvas/grid";
import { useViewportControls } from "@/canvas/use-viewport-controls";
import { useTranslation } from "@/translations";

export function Canvas({ boardId }: { boardId: string }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const {
    viewport,
    sceneRef,
    gridRef,
    resetViewport,
    zoomFromCenter,
    fitIntoView,
  } = useViewportControls(boardId, surfaceRef);
  const { mode, setMode, coarse } = useCanvasMode();
  const { t } = useTranslation();

  const nodes = readNodes(useAtomValue(boardNodesAtom), boardId);
  const assets = useAtomValue(assetsAtom);
  const { commit, undo, redo, canUndo, canRedo } = useBoardHistory(boardId);
  const { selection, setSelection, startMove, startResize, rectFor } =
    useNodeGestures(boardId, viewport);
  const { lasso } = useLasso(boardId, viewport, surfaceRef);

  const [editingId, setEditingId] = useState<NodeId | null>(null);
  /**
   * The image whose text is currently selectable. Exactly one at a time: native
   * selection follows DOM order, so letting two overlays be selectable at once
   * would let a drag produce text from both, interleaved by nothing meaningful.
   */
  const [readingId, setReadingId] = useState<NodeId | null>(null);
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

  const { ingestFiles } = useIngest({
    boardId,
    viewport,
    surfaceRef,
    nodes,
    fitIntoView,
  });
  // Pan mode gives every press to the viewport, so a tap has to hand the node
  // back — otherwise nothing can be selected, and nothing can be deleted.
  useTapSelect(surfaceRef, select);
  // Recognition is derived from the pixels, so it runs off the node list rather
  // than off any user action: an image that arrives by paste, by drop, or by
  // being restored from disk is read the same way.
  useOcr(nodes);
  // Runs alongside recognition rather than after it: neither waits on the
  // other, and the picture on screen waits on neither.
  useCompression(nodes);
  // Best effort and never blocking: a failed round leaves the board exactly as
  // it was, which is what the app already does offline.
  const { syncNow } = useSync(boardId);
  // Whether this board has a remote at all, which is the first half of the
  // question the edit guard asks (D74).
  useKnownRemote(boardId);
  useBoardShortcuts(boardId, readingId === null);

  // A press on empty canvas clears the selection. Registered natively so it
  // runs before the pan handler claims the pointer.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const nodeElement = (event.target as Element | null)?.closest?.(
        "[data-node-id]",
      );
      // An additive press on empty canvas is the start of an additive lasso,
      // so it must not throw away the selection it is meant to add to.
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      // Pan mode clears on the tap instead, in `useTapSelect`: there this
      // press is usually the start of a pan, and clearing here would drop the
      // selection — and the delete button with it — the moment the board moved.
      if (!nodeElement && !additive && currentMode() === "select") {
        setSelection([]);
      }
      // Pressing anywhere that is not the node being read leaves reading mode,
      // including a press on a different node — one overlay at a time. Read
      // through the setter rather than a ref, so this listener never has to be
      // re-registered and never sees a stale value.
      setReadingId((current) =>
        current !== null &&
        nodeElement?.getAttribute("data-node-id") !== current
          ? null
          : current,
      );
    }
    surface.addEventListener("pointerdown", handlePointerDown);
    return () => surface.removeEventListener("pointerdown", handlePointerDown);
  }, [setSelection]);

  // Reading mode owns two keys while it is on. Escape leaves it, and Select All
  // means "all the text in this image" rather than "every node on the board" —
  // the browser's own Select All would take the whole document, chrome included.
  useEffect(() => {
    if (readingId === null) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setReadingId(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        const overlay = surfaceRef.current?.querySelector(
          "[data-testid=ocr-overlay][data-active]",
        );
        if (!overlay) {
          return;
        }
        event.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(overlay);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [readingId]);

  // The size control belongs to exactly one selected text node: with several,
  // it is unclear which the buttons would act on.
  const selectedText =
    selection.length === 1
      ? nodes.find((node) => node.id === selection[0] && node.kind === "text")
      : undefined;

  // Selection chrome is drawn in world space, so it is divided by the zoom to
  // keep a constant thickness on screen.
  const hairline = 2 / viewport.scale;

  return (
    <div className="relative h-full overflow-hidden">
      <div
        ref={surfaceRef}
        data-testid="canvas-surface"
        // A press-and-hold on the board is a gesture, never a text selection:
        // without `select-none` a held finger raises the OS selection handles
        // and takes the whole canvas — every label, every button — as one blob
        // of text, and iOS shows a copy/share callout for a held image even
        // when selection is off (D69). `OCR_WORD` turns both back on for the
        // one thing here that is genuinely text.
        className="absolute inset-0 cursor-default touch-none bg-neutral-950 select-none [-webkit-touch-callout:none]"
      >
        {/* The grid is its own layer rather than a background on the surface:
            it fades out when the dots crowd together, and fading the surface
            would take the whole scene with it. */}
        <div
          ref={gridRef}
          aria-hidden
          data-testid="canvas-grid"
          className="pointer-events-none absolute inset-0"
          style={gridStyle(viewport)}
        />
        <div
          ref={sceneRef}
          data-testid="canvas-scene"
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: sceneTransform(viewport) }}
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
            const isReading = readingId === node.id;
            const asset = node.kind === "image" ? assets[node.assetId] : null;
            // An image with no asset is still a node: it has a position, a
            // size, a place in the order, and it can be selected, moved and
            // deleted. Skipping it rendered a board with an invisible hole in
            // it that still caught clicks — see `MissingAsset`.
            return (
              // Every node is its own context-menu trigger (D83). The primitive
              // merges its handlers into the element rather than wrapping it,
              // so this adds no box to a tree that has one per node.
              <NodeMenu
                key={node.id}
                boardId={boardId}
                node={node}
                asset={asset ?? null}
                onRead={() => setReadingId(node.id)}
              >
                <div
                  data-testid="board-node"
                  data-node-kind={node.kind}
                  data-node-id={node.id}
                  data-selected={isSelected || undefined}
                  data-ocr-status={asset?.ocr.status}
                  data-ocr-words={
                    asset?.ocr.status === "done"
                      ? asset.ocr.words.length
                      : undefined
                  }
                  onPointerDown={(event) => {
                    // A node being read is not draggable: the same drag is how
                    // its text gets selected. Neither is any node in pan mode,
                    // where a press belongs to the viewport (D70).
                    if (!isEditing && !isReading && mode === "select") {
                      startMove(event, node.id);
                    }
                  }}
                  onDoubleClick={() => {
                    if (node.kind === "text" && !isEditing) {
                      startEditing(node.id, node.text);
                      return;
                    }
                    // Double-click means "go inside this node" for both kinds:
                    // into the text to edit it, into the image to read it.
                    if (node.kind === "image" && asset?.ocr.status === "done") {
                      select([node.id]);
                      setReadingId(node.id);
                    }
                  }}
                  className={clsx(
                    // `group` so the recognition badge can expand from an icon
                    // to a sentence while the pointer is anywhere on the node.
                    "group absolute rounded-lg",
                    isReading ? "cursor-text" : "cursor-move",
                  )}
                  style={{
                    left: rect.x,
                    top: rect.y,
                    width: rect.w,
                    // Text lays out at automatic height; only images are sized
                    // in both axes.
                    height: node.kind === "image" ? rect.h : undefined,
                    // An outline follows the element's own `border-radius`, so
                    // rounding the node rounds the selection with it and the two
                    // can never drift apart.
                    //
                    // White while reading, accent otherwise. Inside this mode the
                    // accent belongs to the text selection itself, and a node
                    // outlined in the same colour as the words being dragged
                    // through reads as one more highlight. White also says the
                    // node is in a different mode, which is the thing a
                    // double-click just changed.
                    outline: isSelected
                      ? `${hairline}px solid ${
                          isReading
                            ? "var(--color-neutral-100)"
                            : "var(--color-sky-500)"
                        }`
                      : undefined,
                    // Held off the content rather than drawn on its edge. A
                    // screenshot of a white page swallowed a white outline
                    // completely, and a blue one is no safer against a blue
                    // screenshot — pushed out by its own width, the line always
                    // has the board behind it.
                    outlineOffset: isSelected ? hairline : undefined,
                  }}
                >
                  {node.kind === "image" && asset ? (
                    <>
                      <img
                        src={asset.url}
                        alt=""
                        draggable={false}
                        // Rounded on the image rather than by clipping the node:
                        // `overflow-hidden` here would also cut off the resize
                        // handle, which sits deliberately outside the box.
                        //
                        // The radius is in world units, so it scales with the
                        // zoom. That is the point — it belongs to the picture the
                        // way its size does, and a corner that sharpened as you
                        // zoomed in would read as chrome painted on top.
                        className="pointer-events-none block h-full w-full rounded-lg select-none"
                      />
                      <OcrBadge
                        ocr={asset.ocr}
                        scale={viewport.scale}
                        width={rect.w}
                        height={rect.h}
                        expanded={isSelected}
                      />
                      {asset.ocr.status === "done" && (
                        <OcrOverlay
                          words={asset.ocr.words}
                          assetWidth={asset.width}
                          nodeWidth={rect.w}
                          active={isReading}
                        />
                      )}
                    </>
                  ) : node.kind === "image" ? (
                    // The bytes are not here, but the geometry is: the board
                    // travelled and the image has not caught up. Rendering
                    // nothing left a node that could be selected, dragged and
                    // deleted while being invisible.
                    <MissingAsset scale={viewport.scale} />
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
                  {isSelected &&
                    selection.length === 1 &&
                    !isEditing &&
                    !isReading &&
                    // Not in pan mode: there the press under it belongs to the
                    // viewport, so a handle would be a grip that does nothing —
                    // worse than absent, because it advertises a gesture the
                    // mode does not have (D70).
                    mode === "select" && (
                      // The dot is 12px on screen and the grab area is 24px:
                      // a handle small enough to look right is smaller than
                      // anyone can reliably hit, so the two are separated.
                      <div
                        data-testid="resize-handle"
                        onPointerDown={(event) => startResize(event, node.id)}
                        className="group/handle absolute grid cursor-nwse-resize place-items-center"
                        style={{
                          width: hairline * 12,
                          height: hairline * 12,
                          right: -hairline * 6,
                          bottom: -hairline * 6,
                        }}
                      >
                        {/* A dot with a light ring, not a solid square: the
                          square vanished into any screenshot with a pale
                          corner, and the ring holds its edge against both. */}
                        <div
                          className="rounded-full border-neutral-100 bg-sky-500 transition-colors group-hover/handle:bg-sky-400"
                          style={{
                            width: hairline * 6,
                            height: hairline * 6,
                            borderWidth: hairline,
                            borderStyle: "solid",
                          }}
                        />
                      </div>
                    )}
                </div>
              </NodeMenu>
            );
          })}
          {lasso && (
            <div
              aria-hidden
              data-testid="lasso"
              className="absolute bg-sky-500/10"
              style={{
                left: lasso.x,
                top: lasso.y,
                width: lasso.w,
                height: lasso.h,
                border: `${hairline}px solid var(--color-sky-500)`,
                // Counter-scaled, unlike a node's: the marquee is chrome that
                // exists for the length of one drag, so it should look the same
                // at every zoom rather than belonging to the board.
                borderRadius: hairline * 2,
              }}
            />
          )}
        </div>
      </div>

      {/* Chrome floats over the canvas and never reserves layout space, so the
          board reaches every edge of the window. One tooltip provider covers
          all of it: the delay is for a pointer passing through a control, and
          having already read one label, the next should not make you wait
          again. */}
      <StaleEditDialog />

      <TipProvider>
        {/* One padded layer holds every island. An absolutely positioned child
            is laid out against its containing block's padding box, so the
            safe-area insets on the chrome layer move all of them clear
            of a cutout at once while the canvas underneath stays full bleed
            (D68). */}
        {/* Padding rather than per-widget offsets: an absolutely positioned
            child is laid out against its containing block's PADDING box, so
            these four move all five islands clear of a cutout at once and each
            keeps its own plain `top-3` / `bottom-3`. The canvas underneath is
            deliberately not inset — it runs edge to edge and under the camera
            (D68). */}
        <div
          data-testid="chrome-layer"
          className="pointer-events-none absolute inset-0 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
        >
          <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-1">
            <BoardMenu boardId={boardId} onResetView={resetViewport} />
            <BoardName boardId={boardId} />
          </div>

          {/* Opposite corner from the menu, so the two never crowd a narrow
          window, and away from the zoom and undo controls that get used.
          Reconnect goes on a second row rather than beside the icons: it is
          the widest thing in this corner and it only exists some of the time,
          so on a phone it met the board name coming the other way and the name
          was the one that got truncated. */}
          <div className="pointer-events-none absolute top-3 right-3 flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <SyncButton onSync={syncNow} />
              <About />
            </div>
            <ReconnectPill />
          </div>

          {/* Bottom right: the only corner left, and the reachable one on a phone
          held in either hand. */}
          {/* Desktop only. On touch the same button lives in the mode bar,
              where the thumb already is. */}
          {!coarse && (
            <div className="pointer-events-none absolute right-3 bottom-3">
              <AddImage
                onFiles={(files) => {
                  // No cursor to place against, so it lands in the middle of the
                  // view — the same fallback a paste uses when the pointer has never
                  // been over the canvas.
                  void ingestFiles(files, null);
                }}
              />
            </div>
          )}

          {nodes.length === 0 && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-neutral-600">
              {t("canvas.empty")}
            </p>
          )}

          {/* Conditional controls sit at the end of the row: a control that comes
          and goes must never shift the position of the permanent ones. */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2">
            <Island>
              <IconButton
                label={t("canvas.zoomOut")}
                testId="zoom-out"
                onClick={() => zoomFromCenter(1 / 1.2)}
              >
                <Icon name="remove" />
              </IconButton>
              <button
                type="button"
                data-testid="zoom-reset"
                aria-label={t("canvas.resetView")}
                onClick={resetViewport}
                className="h-8 min-w-14 rounded-full px-3 font-mono text-xs text-neutral-300 tabular-nums transition-colors duration-150 hover:bg-white/10 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none pointer-coarse:h-11"
              >
                {Math.round(viewport.scale * 100)}%
              </button>
              <IconButton
                label={t("canvas.zoomIn")}
                testId="zoom-in"
                onClick={() => zoomFromCenter(1.2)}
              >
                <Icon name="add" />
              </IconButton>
            </Island>
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
                      "grid h-8 w-8 place-items-center rounded-full transition-colors duration-150 pointer-coarse:h-11 pointer-coarse:w-11 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none",
                      selectedText.fontSize === size
                        ? "bg-white/10 text-sky-400"
                        : "text-neutral-400 hover:text-neutral-100",
                    )}
                    style={{ fontSize: 8 + size / 4 }}
                  >
                    A
                  </button>
                ))}
              </Island>
            )}
          </div>

          {/* Touch only, and one row up from the zoom and undo islands rather
            than beside them: on a 412px-wide phone this bar is wide enough to
            reach the bottom-left corner, and a control sitting on top of
            another control is not a layout. */}
          {coarse && (
            <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center">
              <TouchBar
                mode={mode}
                onChange={setMode}
                hasSelection={selection.length > 0}
                onDelete={() => {
                  commit((current) => deleteNodes(current, selection));
                  setSelection([]);
                }}
                addImage={
                  <AddImage
                    className="active:bg-white/10"
                    onFiles={(files) => {
                      void ingestFiles(files, null);
                    }}
                  />
                }
                takePhoto={
                  <TakePhoto
                    className="active:bg-white/10"
                    onFiles={(files) => {
                      void ingestFiles(files, null);
                    }}
                  />
                }
              />
            </div>
          )}
        </div>
      </TipProvider>
    </div>
  );
}

/** A floating chrome group. Excalidraw calls these islands; so do we. */
export function Island({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto flex items-center gap-0.5 rounded-full glass p-1">
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
      className="grid h-8 w-8 place-items-center rounded-full text-neutral-400 transition-colors duration-150 hover:bg-white/10 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30 pointer-coarse:h-11 pointer-coarse:w-11"
    >
      {children}
    </button>
  );
}
