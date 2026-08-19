# Architecture

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│ INGEST            paste · drop · file picker · getDisplayMedia│
│                   Blob → hash → Asset → Node at cursor        │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│ STORE (jotai)     boards · nodes · assets(meta) · viewport    │
│                   single source of truth, world coordinates   │
└─────────────────────────────────────────────────────────────┘
             │                                    │
┌────────────────────────────┐   ┌──────────────────────────────┐
│ PERSISTENCE (IndexedDB)    │   │ RENDER (DOM)                 │
│ asset blobs · board docs   │   │ one CSS transform on scene   │
│ debounced writes           │   │ <img> per node + OCR overlay │
└────────────────────────────┘   └──────────────────────────────┘
                                              │
                              ┌──────────────────────────────┐
                              │ OCR (Web Worker)             │
                              │ Recognizer interface         │
                              │ MockRecognizer ▸ Paddle later │
                              └──────────────────────────────┘
```

## Rendering: DOM, not canvas

The scene is a single element carrying one CSS transform. Nodes are absolutely
positioned children in world coordinates.

```html
<div class="scene" style="transform: translate(TXpx,TYpx) scale(S)">
  <div class="node" style="left:Xpx; top:Ypx; width:Wpx; height:Hpx">
    <img src="blob:…">
    <div class="ocr-layer">
      <span style="left:…; top:…; font-size:…px; transform:scaleX(…)">word</span>
    </div>
  </div>
</div>
```

Why DOM and not Konva/Pixi/raw canvas:

- **Text selection is the product.** A pixel canvas has none, so a canvas build
  ends up overlaying DOM text anyway — two renderers, two coordinate systems,
  permanently out of sync. DOM skips the second system entirely.
- Native selection brings Cmd+C, find-in-page, screen readers, and IME for free.
- One composited transform is GPU-cheap; browsers handle hundreds of layers fine.
- Zero rendering dependencies.

The tradeoff is a node-count ceiling in the low thousands. That is far past the
point where a reference board stops being useful. If it is ever hit, the escape
hatch is virtualization by viewport culling, not a rewrite to canvas.

## The OCR overlay

The hard part of the whole app, and the reason `MockRecognizer` ships first: the
overlay must be built and proven before a real engine exists.

Each `Word` becomes one absolutely positioned `<span>`, transparent text over the
image, so the browser's own selection highlights land on the right pixels.

1. Position and size from the Word's Asset-space box, scaled by `node.w / asset.width`.
2. `font-size` from the box height.
3. Measure the rendered text; apply `transform: scaleX(boxWidth / measuredWidth)`
   with `transform-origin: left top`. Without this correction, selection
   rectangles drift right across a line and the highlight stops matching the pixels.
4. `color: transparent` with `::selection` background left visible.
5. `white-space: pre`, no wrapping — one span is one word, wrapping is a bug.

**Cross-node selection is deliberately blocked.** Native selection follows DOM
order, which has nothing to do with spatial order, so dragging a selection across
two images yields scrambled text. Only one Node's overlay is selectable at a time.

## Coordinate handling

All three spaces are defined in [the domain model](domain-model.md). Two rules:

1. Store world, render world, convert to screen only in pointer handlers.
2. Words live in Asset space forever — never rewrite them on move or resize.

## Persistence

IndexedDB, two stores:

- `assets` — `{ id, blob, width, height, hash }`, content-addressed and refcounted.
- `boards` — `{ id, name, nodes[], viewport, createdAt, updatedAt }`.

`blob:` URLs do not survive reload, so they are recreated from stored Blobs on
board open and revoked on close. Board writes are debounced; asset writes are
immediate (they are the irreplaceable part).

## Routing

Hash history, TanStack Router, file-based routes.

```
#/                  Home — board list, create/rename/delete
#/board/$boardId    Canvas
```

Hash avoids the GitHub Pages deep-link 404 with no `404.html` redirect trick.

## Worker boundary

OCR runs in a dedicated Web Worker. `ImageBitmap` transfers to it zero-copy.
The main thread posts `{ nodeId, bitmap }` and receives `Word[]` or an error;
it never learns which engine answered.
