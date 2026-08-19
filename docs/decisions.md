# Decisions

Each entry: what was decided, why, and what would reverse it. Dated so stale
reasoning is visible.

---

## D1 — Separate repo from `homepage`

**2026-08-19 · settled**

CanWas is its own repo rather than another route on `homepage`.

`homepage` routes are self-contained toys: one route file plus a lazy pair.
CanWas needs a worker, IndexedDB, an overlay renderer, and eventually ~20 MB of
model weights. That weight would degrade the homepage build and cache for a
feature most visitors never open, and `onnxruntime-web` alone violates
homepage's minimal-dependency rule. Precedent exists: `danmaku-ninja`,
`yolo-stream-detect`, `online-screen-recorder`.

homepage links out to it.

---

## D2 — DOM rendering, not a canvas library

**2026-08-19 · settled**

See [architecture](architecture.md#rendering-dom-not-canvas) for the full
argument. Short version: text selection is the product, canvas has none, so a
canvas build re-adds DOM text on top and maintains two coordinate systems forever.

**Reverses if:** node counts pass a few thousand _and_ viewport culling isn't
enough. Not expected.

---

## D3 — OCR deferred behind an interface, mock ships first

**2026-08-19 · settled**

No real engine in the skeleton. `Recognizer` is defined now and `MockRecognizer`
returns plausible fake `Word[]` after an artificial delay.

A no-op returning nothing would leave the overlay layer — the hardest part of the
app — untestable, deferring the risk rather than removing it. Fake data of the
right shape lets the overlay, its zoom behaviour, and every loading state be
built and proven before an engine exists. Swapping in the real one is then a
one-line change.

---

## D4 — PaddleOCR PP-OCRv5 as the eventual engine, hand-rolled pipeline

**2026-08-19 · provisional**

When OCR lands: `onnxruntime-web` plus official PP-OCRv5 weights, with
pre/postprocess written here rather than taken from a wrapper package.

Tesseract.js is more trusted by download count but materially worse at zh-TW.
`ppu-paddle-ocr` wraps the right models but is a single-maintainer package;
its 274 KB of pre/postprocess is small enough to read and own instead of depend
on. `Paddle.js` (the official PaddlePaddle JS repo) is dead — last code commit
2022-09-02 — and ships v2/v3-era models. Measurements in
[OCR research](ocr-research.md).

**Reverses if:** the hand-rolled DBNet postprocess proves a time sink. Fallback
is Tesseract.js behind the same `Recognizer` interface, accepting worse CJK.

---

## D5 — Multiple separate Boards, not pages within one board

**2026-08-19 · settled**

Each Board is an independent document with its own canvas and IndexedDB record.
A Home screen lists them. No nesting.

Flat is the smaller data model and the smaller URL space, and no use case yet
needs images to move between pages of one document. A two-level
board→page hierarchy can be added later; unwinding one is harder.

---

## D6 — Hash router

**2026-08-19 · settled**

GitHub Pages serves a project site under a subpath and 404s on deep-link refresh
for non-hash routes unless a `404.html` redirect shim is added. Hash history has
no such problem. `homepage` moved _away_ from hash because it wants clean URLs
for a public CV; CanWas is a tool and does not care.

---

## D7 — Dark theme only

**2026-08-19 · settled**

One theme, no toggle, no light-mode tokens. A reference board is looked at for
long stretches against image content; a light chrome competes with the images.
Halves the token surface and removes a whole class of contrast bugs.

**Reverses if:** anyone actually asks. Tokens are structured so a light block
could be added in one place.

---

## D8 — Base UI over Radix

**2026-08-19 · settled**

`@base-ui/react`, version 1.7.0.

Chosen on request. Originally recorded as _provisional_ on the belief that Base UI
was pre-stable: `@base-ui-components/react` sits at `1.0.0-rc.0` on npm and
installing it emits a deprecation warning. That package was **renamed** — the
maintained package is `@base-ui/react`, now at 1.7.0, well past a stable 1.0. The
pre-stable caveat does not apply and the decision is settled.

Used so far: `Menu` with `RadioGroup` / `RadioItem` for the language switcher.

## D9 — No `tailwind-merge`

**2026-08-19 · provisional**

`clsx` only.

`tailwind-merge` earns its place when `className` overrides compose through
several layers of shared wrapper components. CanWas styles at the call site and
has few reusable styled components. Dropping it is one fewer dependency to
maintain.

**Reverses if:** class-conflict bugs appear. One-line add, no refactor.

---

## D10 — No Tailwind theme extension

**2026-08-19 · settled**

No custom colors or variables registered in Tailwind config. Stock palette and
scale only.

Requested constraint. Keeps the design inside a system everyone already knows
and stops a bespoke token vocabulary from growing.

---

## D11 — i18n from day one, homepage's pattern minus the scramble

**2026-08-19 · settled**

A `translations` dictionary keyed by translation key, each with `zh-TW` / `en-US`
values, a `useTranslation()` hook, and a jotai atom persisted to `localStorage` —
ported from `homepage/src/translations.ts`.

The scramble transition effect is not ported; it is homepage personality, not
infrastructure. Retrofitting i18n after strings are scattered is expensive, so it
goes in before there are strings to scatter.

---

## D12 — Playwright for happy-path E2E, with screenshots

**2026-08-19 · settled**

The core interaction is pointer-driven and clipboard-driven. Unit tests cannot
tell you that pasting an image put a node under the cursor at the right zoom.
Scope is deliberately one happy path, not a regression net.

**Run locally, not in CI.** Browser tests in CI add install time and a class of
flake that costs more attention than it returns on a project this size. CI runs
`npm run check` and deploys; `npm run test:e2e` is run by hand alongside the work
that changes behaviour.

---

## D13 — OCR state lives on the Asset, not the Node

**2026-08-19 · settled · supersedes part of the original domain model**

`OcrState` is a field of `Asset`. `Node` has no `ocr` field and reads recognition
through its `assetId`.

The original doc contradicted itself: it put `ocr` on Node while also stating that
Words live in Asset space "so two Nodes sharing an Asset share one recognition
result". Both could not be true. Recognition is a property of pixels, not of
placement — so duplicating a Node is free, and re-pasting the same screenshot into
a different Board hits a cache keyed by content hash rather than re-running a
20 MB model over identical bytes.

**Reverses if:** per-node recognition options appear (a language override, or
recognizing only a cropped region). Then results stay on the Asset keyed by
options, and only the key moves to the Node.

---

## D14 — Assets are garbage collected by mark-and-sweep, not refcounting

**2026-08-19 · settled · supersedes "reference-counted" in the original model**

At startup, walk every Board's nodes, union their `assetId`s, delete every Asset
outside that set.

A stored refcount must be adjusted on every mutation path, and a crash between
the node write and the counter write desyncs it permanently — leaking blobs
forever or deleting an image still on screen. Mark-and-sweep has no state to
corrupt and repairs itself on the next run. Boards are small enough that the walk
is milliseconds.

Startup is the only safe moment, because undo history is in-memory
([D16](#d16--undo-history-is-in-memory-and-per-session)) and therefore always
empty then. Board deletion is not undoable, so its orphans simply wait.

---

## D15 — Undo/redo is an inverse-patch log

**2026-08-19 · settled**

Each mutation produces a `Change` carrying a forward patch and its exact inverse.
Memory is proportional to what changed, not to board size.

Full-board snapshots are impossible to get wrong but scale with depth × board
size. Immer would generate inverses automatically and remove the hand-written-
inverse risk, at the cost of a dependency the project is trying to avoid. The
mitigation for hand-written inverses is that a mutation and its inverse are
produced by the same function and never written separately.

---

## D16 — Undo history is in-memory and per-session

**2026-08-19 · settled**

The stack lives in a jotai atom and is cleared on reload.

This is what makes [D14](#d14--assets-are-garbage-collected-by-mark-and-sweep-not-refcounting)
provably safe rather than carefully safe: the stack is empty at startup, so the
sweep and the history stack can never disagree about what is live. Persisting
history would force the sweep's live-set to union every history-referenced asset,
and getting that union wrong restores a node pointing at deleted bytes.

Matches user expectation — Figma and Excalidraw both drop undo on reload.

---

## D17 — Undo covers content only, on a per-board stack

**2026-08-19 · settled**

In: node add, move, resize, delete, reorder, paste. Out: pan, zoom, node
selection, board create/rename/delete, language toggle.

Pan and zoom are view state, not content. `Cmd+Z` that moves the camera instead of
reverting the mistake leaves the user with both the mistake and no idea where they
are — and trackpad users would generate camera entries constantly. A global stack
across boards would let `Cmd+Z` on one board silently alter another.

Gestures coalesce: one drag is one Change, pushed at pointer-up.

**Consequence:** board delete is not undoable, so it requires a confirmation
dialog.

---

## D18 — Paint order is array order; `Node.z` does not exist

**2026-08-19 · settled · supersedes `z` in the original model**

Position in `Board.nodes` is the paint order and the only representation of it.
DOM render order follows it, so no `z-index` is used anywhere.

The original doc defined paint order twice — a `z` field _and_ an ordered array —
which would have drifted and surfaced as z-fighting after an undo. Array order
also composes with [D15](#d15--undoredo-is-an-inverse-patch-log): the delete
inverse already stores `{ insert: node, at: index }`, so restoring stacking order
is free.

---

## D19 — Paste sizes nodes to fit the viewport

**2026-08-19 · settled**

A pasted image is scaled to occupy at most ~40% of the current viewport, and is
**never enlarged** — images smaller than that keep intrinsic size.

Chosen over intrinsic-pixel sizing because retina screenshots are 2x and would
land at double their on-screen size, needing a resize after every paste.

**Known cost, accepted:** this is not deterministic. The same image pasted at two
zoom levels produces two different world sizes, and pasting a batch at varying
zoom gives inconsistent scales.

---

## D20 — Durability: request persistent storage, design for export, build it later

**2026-08-19 · settled**

`navigator.storage.persist()` is called at startup. The board document stays plain
JSON-serializable and assets stay separable, so a `.canwas` export is a later
feature with no schema migration.

IndexedDB is evictable under disk pressure and eviction is silent — the first
symptom would be an empty Home screen. One line of code removes that risk. Full
export/import is real work (archive format, file picker, import merge conflicts)
and does not belong in the skeleton.

---

## D21 — Ingest reads `clipboardData`, never the async Clipboard API

**2026-08-19 · settled**

Paste handling reads `event.clipboardData.files`. `navigator.clipboard.read()` is
forbidden.

A testability constraint, not a preference. Real OS-clipboard image paste is not
reliably automatable across browsers; the workable path is dispatching a synthetic
`ClipboardEvent` with a `DataTransfer` from inside `page.evaluate`. An app reading
the async Clipboard API cannot be driven that way, which would make the required
happy-path E2E ([D12](#d12--playwright-for-happy-path-e2e-with-screenshots))
impossible to write.
