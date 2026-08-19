# Architecture

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│ INGEST            paste · drop · file picker · getDisplayMedia│
│                   Blob → hash → Asset → Node, fit to viewport │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│ STORE (jotai)     boards · nodes · assets · viewport · history│
│                   single source of truth, world coordinates   │
└─────────────────────────────────────────────────────────────┘
             │                                    │
┌────────────────────────────┐   ┌──────────────────────────────┐
│ PERSISTENCE (IndexedDB)    │   │ RENDER (DOM)                 │
│ asset blobs + OCR results  │   │ one CSS transform on scene   │
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
    <img src="blob:…" />
    <div class="ocr-layer">
      <span style="left:…; top:…; font-size:…px; transform:scaleX(…)"
        >word</span
      >
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

## Input model

| Gesture                                        | Effect                            |
| ---------------------------------------------- | --------------------------------- |
| Drag on empty canvas, or middle-drag           | Pan                               |
| Two-finger scroll                              | Pan                               |
| Pinch (`ctrlKey` + wheel), `shift`/`⌘` + wheel | Zoom, anchored at cursor          |
| `⌘0`                                           | Reset viewport                    |
| `⌘=` / `⌘-`                                    | Zoom, anchored at viewport centre |

Wheel and pointer listeners are attached natively rather than via React props,
because the wheel handler must `preventDefault` and React's synthetic listener
cannot be made non-passive.

Every viewport update goes through the functional setter form. That keeps the
listeners independent of the current viewport, so they are attached once rather
than being torn down and re-attached on every frame of a pan — which would drop
pointer events mid-gesture.

**Wheel delta must be clamped before it reaches the zoom exponent.** The same
`ctrlKey + wheel` signal arrives from two very different devices: a trackpad
pinch streams small deltas (~1-5), a mouse sends one large delta per notch
(100-240). One exponential over both makes a single mouse notch cross the entire
zoom range.

## Coordinate handling

All three spaces are defined in [the domain model](domain-model.md). Two rules:

1. Store world, render world, convert to screen only in pointer handlers.
2. Words live in Asset space forever — never rewrite them on move or resize.

## Persistence

IndexedDB, two stores:

- `assets` — `{ id, blob, width, height, hash, ocr }`, content-addressed and
  shared across every Board.
- `boards` — `{ id, name, nodes[], viewport, createdAt, updatedAt }`, plain
  JSON-serializable so a future `.canwas` export needs no schema migration.

`blob:` URLs do not survive reload, so they are recreated from stored Blobs on
board open and revoked on close. Board content writes are debounced; viewport
writes are debounced harder and never bump `updatedAt`; asset writes are
immediate, since they are the irreplaceable part.

`navigator.storage.persist()` is requested at startup. Without it IndexedDB is
evictable under disk pressure, and eviction is silent — the first sign of trouble
would be an empty Home screen.

### Asset garbage collection

Assets are **not** reference-counted. A stored counter has to be adjusted on
every mutation path, and a crash between the two writes desyncs it permanently —
either leaking blobs forever or deleting an image still on screen.

Instead, mark-and-sweep, **at startup only**:

```
live = union of every board's nodes' assetId
for asset in assets:
    if asset.id not in live: delete asset
```

There is no state to corrupt, so a crash mid-write cannot break it — the next
sweep repairs everything. Boards are small; the walk is milliseconds.

Startup is the safe moment because undo history is in-memory and therefore always
empty at that point. If the sweep ran after a board delete, it could reclaim
assets that an undo entry still needed. Board deletion is not undoable (it gets a
confirmation dialog instead), so its orphans simply wait for the next startup.

## History

Per-Board, in-memory, cleared on reload. See
[Change and History](domain-model.md#change) for the shape.

Every mutation is written as a function returning both its forward patch and its
exact inverse. A mutation without an inverse is a corruption bug, so the two are
produced in the same place and never separately.

```ts
function moveNodes(ids: NodeId[], dx: number, dy: number): Change;
// apply:  each id += (dx, dy)
// invert: each id -= (dx, dy)
```

Gestures coalesce. A drag mutates node positions live for feedback but pushes a
single Change at pointer-up, carrying the position from pointer-_down_. Pushing
per `pointermove` would bury every real action under hundreds of entries.

Deleting a node stores the whole node plus its array index, so undo restores both
the node and its exact place in the paint order — the same array position that
[D8](decisions.md) made canonical.

## Routing

Hash history, TanStack Router, file-based routes.

```
#/                  Home — board list, create/rename/delete
#/board/$boardId    Canvas
```

Hash avoids the GitHub Pages deep-link 404 with no `404.html` redirect trick.

## Ingest

`Blob → hash → Asset → Node`.

1. SHA-256 the bytes. The hash **is** the `AssetId`, so identical bytes can never
   occupy two Assets and a duplicate paste inherits the existing recognition
   result.
2. `createImageBitmap` for intrinsic dimensions, then close the bitmap.
3. Size the node to at most 40% of the visible canvas, never enlarging (D19).
4. Centre it on the drop point, or on the viewport centre for a paste, which has
   no coordinates of its own.
5. Cascade off any node already at that origin.

**Cascade must consult the board, not the batch.** Offsetting by index within one
drop is not enough: pasting the same image twice is two separate ingests, each
starting from index 0, so the second copy lands exactly under the first and looks
like nothing happened. Placement is therefore resolved inside the state setter,
where the authoritative node list is visible.

Object URLs are created per Asset and are currently never revoked — Assets live
for the session. Lifecycle arrives with persistence at step 5.

## Clipboard constraint

Ingest reads images from the paste event's `clipboardData.files`. It must **never**
use `navigator.clipboard.read()`.

This is a testability constraint, not a preference. Real OS-clipboard image paste
cannot be automated reliably across browsers; the only workable path is
dispatching a synthetic `ClipboardEvent` carrying a `DataTransfer` from inside
`page.evaluate`. An app reading the async Clipboard API cannot be driven that way,
which would make the required happy-path E2E impossible to write.

## Worker boundary

OCR runs in a dedicated Web Worker. `ImageBitmap` transfers to it zero-copy.
The main thread posts `{ nodeId, bitmap }` and receives `Word[]` or an error;
it never learns which engine answered.
