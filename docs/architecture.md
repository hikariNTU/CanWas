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

Chrome floats over the canvas and reserves no layout space (D24), so a press
near a corner can land on a control rather than the board.

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

## Persistence timing

Three different write cadences, because the three things have different values:

| What          | Cadence           | Bumps `updatedAt` |
| ------------- | ----------------- | ----------------- |
| Asset bytes   | immediate         | —                 |
| Board content | debounced 400 ms  | yes               |
| Viewport      | debounced 1000 ms | **no**            |

Asset bytes are irreplaceable and cannot be reconstructed, so they are never
debounced. Layout can be redone by hand; camera position is pure churn.

Panning must not bump `updatedAt`, or the Home list's "last edited" degrades
into "last opened" and stops being a useful sort order.

**Debounced saves lose the tail of a session.** Closing the tab inside the
debounce window keeps the asset bytes, which were written immediately, and drops
the node that referenced them — leaving an orphan for the next sweep and losing
the user's paste. A flush on `visibilitychange` and `pagehide` covers tab close,
tab switch and mobile backgrounding.

Opening a board id that does not exist creates it. There is no 404 path: boards
are cheap, deep links should always work, and a stray board is easier to delete
than a dead link is to explain.

The canvas does not render until the board has loaded. Rendering earlier would
let an edit write an empty node list over stored content.

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

## Gestures

A drag renders from a **transient overlay** held in component state, not from the
store. The store changes exactly once per gesture, at pointer-up, which is the
granularity the history stack wants (D17) — and an abandoned gesture needs no
cleanup, because the store was never touched.

```
pointerdown → overlay = { ids, dx: 0, dy: 0 }
pointermove → overlay.dx/dy = (client - origin) / scale     ← render only
pointerup   → commit(moveNodes(...))  ·  overlay = null
```

Gesture listeners are bound to `window`, not to the pressed element, and only
one gesture runs at a time. `pointercancel` aborts; only `pointerup` commits
(D27). An element listener dies with its element, and a gesture that never gets
its `pointerup` leaves the overlay stuck — the node draws at gesture geometry
until a later commit clears it, then snaps back to stored geometry.

Selection chrome is drawn inside the scene, so its thickness is divided by
`viewport.scale` to stay constant on screen.

Resize is aspect-locked. Images have one true aspect ratio; a free resize could
only ever distort them.

### Event ownership between native and React listeners

The canvas attaches `pointerdown` **natively** (it needs non-passive wheel
handling, and both live together), while nodes use React props. React delegates
to the root container, so the canvas's native ancestor listener runs _first_,
during real DOM propagation — before React's synthetic handler exists.

A node therefore **cannot** call `stopPropagation()` to stop a pan. It fails
silently and doubly: the node moves by the drag delta _and_ the whole viewport
pans by the same delta, so the node appears to travel twice as far.

The ownership test lives in the pan handler instead:

```ts
if (event.button === 0 && event.target.closest("[data-node-id]")) return;
```

Middle-drag still pans from anywhere, including over a node.

## Routing

Hash history, TanStack Router, file-based routes.

```
#/                        resolves to the latest board, or creates one
#/$boardSlug              Canvas — the only screen (D31)
   └─ qyzs34jb14rz-mood-board
      ^^^^^^^^^^^^ authoritative id  ^^^^^^^^^^ decoration (D33)
#/~*                      reserved for future non-board routes (D34)
```

A bare id or a stale slug both resolve; the app then rewrites the URL to the
canonical form with `replace`, so it stays out of history.

Hash avoids the GitHub Pages deep-link 404 with no `404.html` redirect trick.

## Ingest

`Blob → hash → Asset → Node`.

1. SHA-256 the bytes. The hash **is** the `AssetId`, so identical bytes can never
   occupy two Assets and a duplicate paste inherits the existing recognition
   result.
2. `createImageBitmap` for intrinsic dimensions, then close the bitmap.
3. Size the node to at most 40% of the visible canvas, never enlarging (D19).
4. Centre it on the drop point. A paste carries no coordinates, so the last
   pointer position over the canvas stands in, falling back to the viewport
   centre if the pointer has never been over it (D23).
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
The main thread posts `{ assetId, bitmap }` and receives `Word[]` or an error;
it never learns which engine answered. (This said `nodeId` until step 6 built
it — a leftover that contradicted [D13](decisions.md), which puts recognition
on the Asset. Keying by node would recognize the same pixels once per node and
orphan a result when its node was deleted mid-run.)

The main thread sends one job at a time and waits for an answer before sending
the next. See [D39](decisions.md).
