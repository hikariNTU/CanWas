# Domain model

The vocabulary of CanWas. These words mean exactly this, in code and in
conversation. If a concept isn't here, it doesn't exist yet.

## Nouns

### Board

An independent document. One infinite canvas, one persistence record, one URL.
Boards do not nest and do not share content. A user has many boards; the Home
screen lists them.

```
id        BoardId       stable, URL-safe, generated once
name      string        user-editable, not unique, not an identifier
nodes     Node[]        ORDER IS PAINT ORDER — index 0 is backmost
viewport  Viewport      where the user was last looking
createdAt number        epoch ms
updatedAt number        epoch ms, bumped on CONTENT change only
```

`updatedAt` tracks edits, not visits. Panning and zooming persist the viewport
but must not bump it, or "last edited" degrades into "last opened".

### Node

One thing placed on a Board. Today the only kind is an image. The type is a
discriminated union from day one so notes, arrows, and groups can be added
without reshaping the store.

```
id        NodeId
kind      "image"
x, y      number        WORLD coordinates of the top-left corner
w, h      number        WORLD size
assetId   AssetId       points at the Asset holding the bytes
```

There is **no `z` field**. Position in `Board.nodes` is the paint order, and it is
the only representation of it. Bring-to-front is a splice to the end of the array.
DOM render order follows array order, so no `z-index` is used anywhere.

There is **no `ocr` field**. Recognition belongs to pixels, not to placement — see
Asset.

A Node holds no pixels, only a pointer to an Asset. Two Nodes may share one Asset;
that is how duplication works.

### Asset

Immutable image bytes, their intrinsic dimensions, and their recognition result.
Lives in IndexedDB as a Blob. Shared freely across Nodes and across Boards.

```
id        AssetId
blob      Blob
width     number        intrinsic pixels
height    number        intrinsic pixels
hash      string        content hash — pasting the same image twice reuses one Asset
ocr       OcrState      recognition result, see below
```

Assets are content-addressed. Pasting the same screenshot into two Boards stores
one copy and recognizes it once. Duplicating a Node costs nothing.

Assets are **not** reference-counted. See
[garbage collection](architecture.md#asset-garbage-collection).

### Viewport

The window onto a Board's infinite plane.

```
tx, ty    number        world-space translation
scale     number        zoom factor, clamped
```

Stored in the Board record so returning to a board restores where you were.
Writes are heavily debounced and never touch `updatedAt`.

### Word

One recognized token with a box, in the Asset's own pixel space — never world or
screen space. Asset-space boxes survive a Node being moved, resized, or
duplicated, and let two Nodes share one recognition result.

```
text        string
x0,y0,x1,y1 number      Asset pixel coordinates
confidence  number      0..1
```

### OcrState

An Asset's recognition status. Explicit states, not booleans, so the UI can render
each one honestly.

```
{ status: "idle" }
{ status: "queued" }
{ status: "running", progress?: number }
{ status: "done", words: Word[] }
{ status: "failed", error: string }
```

### Recognizer

The seam OCR sits behind. The only thing the rest of the app knows about OCR.

```ts
interface Recognizer {
  recognize(bitmap: ImageBitmap, signal?: AbortSignal): Promise<Word[]>;
}
```

Two implementations are planned: `MockRecognizer` (ships first, returns plausible
fake boxes after a fake delay) and `PaddleRecognizer` (later, real). Nothing
outside `src/ocr/` may import either one directly.

### Change

One undoable unit of work: a forward patch and its exact inverse.

```
label     string        for UI and debugging, e.g. "move 3 nodes"
apply     Patch         forward
invert    Patch         exact inverse
```

A Change is pushed at the _end_ of a gesture, not during it — one drag produces
one Change at pointer-up, never one per `pointermove`.

### History

A per-Board, in-memory stack of Changes. Cleared on reload. Bounded depth.

```
past      Change[]
future    Change[]
```

What produces a Change: node add, move, resize, delete, reorder, paste.

What does not: pan, zoom, node selection, board create/rename/delete, language
toggle. Panning is not an edit, and `Cmd+Z` moving the camera instead of
reverting a mistake leaves the user with both the mistake and no idea where
they are.

## Coordinate spaces

Three, and mixing them up is the main source of bugs in an app like this. Every
variable holding a coordinate must make its space obvious in its name.

| Space      | Origin            | Unit               | Used by        |
| ---------- | ----------------- | ------------------ | -------------- |
| **Asset**  | image top-left    | intrinsic image px | `Word` boxes   |
| **World**  | board origin      | world units        | `Node.x/y/w/h` |
| **Screen** | viewport top-left | CSS px             | pointer events |

Conversions, and there are only these two:

```
screen = (world * scale) + translate
world  = (screen - translate) / scale
```

Asset to World is per-Node: `world = node.x + (assetX * node.w / asset.width)`.

## Verbs

- **Ingest** — turn a pasted/dropped Blob into an Asset plus a Node.
- **Pan / Zoom** — mutate the Viewport. Never mutates Nodes, never undoable.
- **Recognize** — run an Asset through the Recognizer, filling its `OcrState`.
- **Sweep** — delete Assets no Board references. Startup only.
- **Select** (two unrelated meanings, always qualify which):
  - _node selection_ — which Nodes are picked for move/delete. Not undoable.
  - _text selection_ — the browser's native selection over the OCR overlay.

## Deliberately absent

No layers, no groups, no crop, no multi-user presence, no server, no accounts.
Crop is the most likely next addition: it becomes an optional `srcRect` on Node
defaulting to the full Asset, which is a cheap migration.
