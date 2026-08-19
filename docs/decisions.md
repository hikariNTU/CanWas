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

---

## D22 — Mutations are built at commit time, from the store

**2026-08-19 · settled · amends [D15](#d15--undoredo-is-an-inverse-patch-log)**

`commit` takes a _builder_ — `(nodes) => Change` — and history is implemented as
jotai write atoms, which read current state synchronously through `get`.

Originally a Change was built from the node list captured in the component's
render closure. That snapshot goes stale in two ordinary situations:

- Two gestures in quick succession. A resize starting before React re-rendered
  from the preceding drag anchored to old geometry, so the node jumped and its
  inverse undid to the wrong place.
- An async paste. `Select All` selected only the nodes that existed when the
  key listener last registered, silently missing the newest one.

Gesture handlers read the store directly for their base geometry too. The rule
is now: **no mutation, and no inverse, is ever derived from a render snapshot.**

---

## D23 — Paste lands under the cursor

**2026-08-19 · settled · amends [D19](#d19--paste-sizes-nodes-to-fit-the-viewport)**

A paste event carries no coordinates, so the last pointer position over the
canvas stands in for the cursor. If the pointer has never been over the canvas —
straight after load, or after leaving it — placement falls back to the viewport
centre.

Sizing is unchanged: at most 40% of the visible canvas, never enlarged.

---

## D24 — Immersive canvas, chrome floats

**2026-08-19 · settled**

The board screen has no header and no toolbar strip. The canvas reaches every
edge of the window and all controls float over it in rounded "islands", the
Excalidraw arrangement: menu top-left, zoom and history bottom-left.

Consequence worth remembering: chrome now overlaps the canvas corners, so a
press near a corner may hit a control rather than the board. Tests that pan or
click "empty" canvas must aim at clear space.

The shared root layout renders no chrome at all — a header there would have to
be hidden on the one screen that matters. Home renders its own.

---

## D25 — The Pages base path is case-sensitive

**2026-08-19 · settled**

`base` is `/CanWas/`, matching the repository name exactly.

Measured:

```
200  https://hikarintu.github.io/CanWas/
404  https://hikarintu.github.io/canwas/
200  https://hikariNTU.github.io/CanWas/
```

The **host** is case-insensitive and normalised to lowercase; the **path**
preserves the repository's case and does not redirect. Lower-casing `base`, or
linking to `/canwas/`, produces a hard 404.

Renaming the repository to `canwas` would remove the trap. Not done, since it
would break the existing URL.

---

## D26 — Debounced writes read the store, never a captured snapshot

**2026-08-19 · settled · extends [D22](#d22--mutations-are-built-at-commit-time-from-the-store)**

Every persistence write reads `nodes` and `viewport` from the jotai store at the
moment it runs.

A debounced timer fires long after the render that scheduled it. The viewport
save captured `nodes` in its closure but listed only `viewport` in its
dependencies, so it re-ran only when the camera moved — and kept writing the
node list from hydration time. Its 1000 ms timer then landed _after_ edits made
in the first second of a session and wrote them away. Nothing looked wrong until
the board was reopened, where it appeared as work silently reverting.

D22 established this rule for mutations. It applies to any deferred write.

---

## D27 — Pointer gestures listen on `window` and abort on cancel

**2026-08-19 · settled**

`pointermove` / `pointerup` / `pointercancel` are bound to `window` for the life
of a gesture, not to the element that was pressed. One gesture runs at a time.
`pointercancel` discards the gesture; only `pointerup` commits.

Element listeners stop firing the moment the element unmounts or loses pointer
capture. A gesture that never receives its `pointerup` leaves the render overlay
stuck, so the node keeps drawing at gesture geometry until some later commit
clears the overlay — at which point it snaps back to whatever the store still
held. The visible symptom is a resize that "un-does itself" after the next drag.

Committing on `pointercancel` is separately wrong: the event carries no
meaningful final position, so it writes a rectangle the user never chose.

---

## D28 — Icons come from `lucide-react`

**2026-08-19 · settled**

Imported by the `*Icon`-suffixed name, matching the sibling `homepage` repo's
convention.

Unicode glyphs were standing in for icons — `☰`, `↺`, `⌖`, `●`. They inherit the
system font's weight and baseline, so they sit differently on each platform,
cannot be sized or coloured as a set, and read as improvised next to real UI.

One dependency, tree-shaken per icon.

---

## D29 — The board title is editable in place, with no surface at rest

**2026-08-19 · settled**

Clicking the title turns it into a text field: Enter or blur commits, Escape
abandons, an empty or unchanged name is refused.

A background is a signal that something is interactive. Chrome that is only read
does not earn one, so the title is bare text over the canvas and gains a field
only while being edited.

Renaming is **not** undoable — the history stack covers board content only
(D17) — so it writes straight through. Key events inside the field stop
propagating, or Backspace and `⌘A` would reach the board and delete nodes.

---

## D30 — A write in flight can be lost to a reload

**2026-08-19 · known limitation**

`putBoard` is asynchronous. Reloading within a few milliseconds of a change can
abort the transaction, and the record either never lands or lands after the new
page has already hydrated — briefly reading as the change having been discarded.

Not fixable from here: the browser is free to abort a transaction during
navigation, and nothing may block unload. The realistic sequence — change
something, keep working, reload later — is safe, and the `pagehide` flush covers
ordinary tab closes.

The practical consequence is for tests: **poll the store for the written value
before reloading**, rather than reloading straight after asserting the UI.

---

## D31 — No home screen; `/` opens a board

**2026-08-19 · settled · supersedes the Home list from step 5**

The root route resolves to the most recently edited board, creating an empty one
if the store is empty, and redirects there. There is no index page.

An index listing one-to-three boards is a stop on the way to the only screen
that does anything. Excalidraw opens straight onto a canvas for the same reason:
the tool should be usable the moment it loads, with no decision to make first.

The board list moved into the board menu, alongside New board, Delete board,
Reset view and language. Board metadata for _every_ board is therefore loaded
during board hydration rather than by a separate screen.

Deleting the current board falls through to the next most recent, or a fresh one
if it was the last — the user is never left on a board that no longer exists.

---

## D32 — Short base32 ids, not UUIDs

**2026-08-19 · settled**

Boards and nodes use a 12-symbol id from Crockford's base32 alphabet, lowercased:
`qyzs34jb14rz`.

`crypto.randomUUID()` produces 36 characters, which dominated the address bar
and was repeated in every stored node record. Nothing here needs RFC 4122 — ids
are opaque local keys.

Alphabet is the digits and letters minus `i`, `l`, `o` and `u`: that removes the
pairs misread when an id is retyped or read aloud (`1/l/i`, `0/o`), and `u` so
the alphabet cannot spell accidental profanity.

**Exactly 32 symbols is what makes the generator unbiased.** 32 divides 256, so
masking a uniform random byte to its low 5 bits yields a uniform symbol. An
alphabet whose size is not a power of two — base62, say — would need rejection
sampling, and a plain modulo would quietly favour its earlier letters.

12 symbols is 60 bits. Measured over 300,000 generated ids: no collisions, all
32 symbols used, worst-case symbol frequency 0.4% off uniform.

Hand-rolled at ten lines rather than adding `nanoid`, which would be a
dependency for one function.

Existing UUID-keyed boards keep working — ids are opaque strings and nothing
parses them.
