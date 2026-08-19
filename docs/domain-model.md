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
createdAt number        epoch ms
updatedAt number        epoch ms, bumped on any mutation
```

### Node
One thing placed on a Board. Today the only kind is an image. The type is a
discriminated union from day one so that notes, arrows, and groups can be added
without reshaping the store.

```
id        NodeId
kind      "image"
x, y      number        WORLD coordinates of the top-left corner
w, h      number        WORLD size; starts at the image's intrinsic pixel size
z         number        paint order, ascending
assetId   AssetId       points at the Asset holding the bytes
ocr       OcrState      see below
```

A Node holds no pixels. It holds a pointer to an Asset. Two Nodes may share one
Asset — that is how duplication works, and it is why Assets are reference-counted
rather than deleted with their Node.

### Asset
Immutable image bytes plus intrinsic dimensions. Lives in IndexedDB as a Blob.

```
id        AssetId
blob      Blob
width     number        intrinsic pixels
height    number        intrinsic pixels
hash      string        content hash; pasting the same image twice reuses one Asset
```

Assets are content-addressed. Pasting the same screenshot into two Boards stores
one copy.

### Viewport
The window onto a Board's infinite plane. Not persisted with the Board's content;
it is view state, saved separately per Board so returning to a Board restores
where you were.

```
tx, ty    number        world-space translation
scale     number        zoom factor, clamped
```

### Word
One recognized token with a box, in the Asset's own pixel space — never world or
screen space. Storing Words in Asset space means they survive a Node being moved,
resized, or duplicated, and two Nodes sharing an Asset share one recognition
result.

```
text        string
x0,y0,x1,y1 number      Asset pixel coordinates
confidence  number      0..1
```

### OcrState
A Node's recognition status. Explicit states, not booleans, so the UI can render
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

Two implementations are planned: `MockRecognizer` (ships first, returns
plausible fake boxes after a fake delay) and `PaddleRecognizer` (later, real).
Nothing outside `src/ocr/` may import either one directly.

## Coordinate spaces

Three, and mixing them up is the main source of bugs in an app like this. Every
variable holding a coordinate must make its space obvious in its name.

| Space | Origin | Unit | Used by |
| --- | --- | --- | --- |
| **Asset** | image top-left | intrinsic image px | `Word` boxes |
| **World** | board origin | world units (1:1 with image px at scale 1) | `Node.x/y/w/h` |
| **Screen** | viewport top-left | CSS px | pointer events |

Conversions, and there are only these two:

```
screen = (world * scale) + translate
world  = (screen - translate) / scale
```

Asset to World is per-Node: `world = node.x + (assetX * node.w / asset.width)`.

## Verbs

- **Ingest** — turn a pasted/dropped/captured Blob into an Asset plus a Node.
- **Pan / Zoom** — mutate the Viewport. Never mutates Nodes.
- **Recognize** — run a Node's Asset through the Recognizer, filling `OcrState`.
- **Select** (two unrelated meanings, always qualify which):
  - *node selection* — which Nodes are picked for move/delete.
  - *text selection* — the browser's native selection over the OCR overlay.

## Deliberately absent

No layers, no groups, no multi-user presence, no server, no accounts, no
undo/redo yet. Each of these earns its way in later or not at all.
