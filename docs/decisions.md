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

**2026-08-19 · settled · superseded by [D55](#d55--paint-order-is-a-fractional-index-per-node) · supersedes `z` in the original model**

> Superseded. Array order was right while the board lived on one device, and it
> is the specific thing sync breaks — an index is the one field two devices
> cannot merge. The reasoning below still holds against a `z` field; D55 keeps
> the conclusion that paint order has exactly one representation and changes
> what that representation is.

Position in `Board.nodes` is the paint order and the only representation of it.
DOM render order follows it, so no `z-index` is used anywhere.

The original doc defined paint order twice — a `z` field _and_ an ordered array —
which would have drifted and surfaced as z-fighting after an undo. Array order
also composes with [D15](#d15--undoredo-is-an-inverse-patch-log): the delete
inverse already stores `{ insert: node, at: index }`, so restoring stacking order
is free.

---

## D19 — Paste sizes nodes to fit the viewport

**2026-08-19 · settled · superseded by [D59](#d59--paste-sizes-nodes-at-their-own-size-corrected-for-density)**

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

## D25 — The repository is lower-case, so the base path is too

**2026-08-19 · settled · revised 2026-08-19**

`base` is `/canwas/`, matching the repository name exactly.

The Pages **host** is case-insensitive and normalised to lower-case; the
**path** preserves the repository's case and does not redirect. Measured while
the repository was still named `CanWas`:

```
200  https://hikarintu.github.io/CanWas/
404  https://hikarintu.github.io/canwas/
200  https://hikariNTU.github.io/CanWas/
```

A mixed-case repository name therefore hard-404s the URL people actually type.
The repository was renamed to `canwas` rather than carrying that trap. Nothing
linked to the old URL yet, which is the only reason the rename was free — GitHub
redirects `github.com` repository URLs after a rename but does **not** redirect
the Pages URL.

The product is still called CanWas. Only the path is lower-case.

The base path now has exactly two owners: `base` in `vite.config.ts` and
`BASE_URL` in `playwright.config.ts`. Tests navigate with relative URLs
(`goto("./")`, `goto("#/demo")`) so they resolve against Playwright's `baseURL`
instead of repeating the path — 27 copies of it were what made the rename look
expensive.

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

Boards keyed by the old UUIDs are not supported: [D33](#d33--board-urls-carry-a-slug-after-the-id)
splits the URL segment at its first hyphen, which a UUID contains four of. No
migration was written — the store was scratch data at the time.

---

## D33 — Board URLs carry a slug after the id

**2026-08-19 · settled**

`#/board/qyzs34jb14rz-mood-board`. The id is authoritative; the slug is
decoration.

A bare id resolves. A stale slug from before a rename resolves. In both cases
the app rewrites the URL to the canonical form with `replace`, so it stays out of
history and Back still leaves the board rather than bouncing between spellings.
This is how GitHub and Notion handle it, and it means renaming a board can never
break a link someone kept.

Parsing is "everything before the first hyphen", which works precisely because
the base32 id alphabet excludes `-` (D32). The two decisions hold each other up:
a base62 or UUID id would need a delimiter that could appear in a name.

Slugs keep letters and numbers in **any** script — `\p{L}`, not `[a-z]` — so
設計參考 survives as itself instead of being stripped to an empty slug. It
appears percent-encoded in `location.href` and decoded in the address bar, as
non-ASCII URLs always have.

---

## D34 — Boards live at the root, `~` is reserved

**2026-08-19 · settled**

`#/qyzs34jb14rz-mood-board`, not `#/board/qyzs34jb14rz-mood-board`.

Since D31 removed the home screen the app has one screen type, so `/board/`
distinguished nothing — it was a constant prefix naming a category with one
member.

The namespace it protected is recovered with a reserved character instead: `~`
is absent from the base32 id alphabet (D32) and stripped by `toSlug`, and a
board segment always begins with its id, so no board can ever produce one.

```
#/qyzs34jb14rz-mood-board   always a board
#/~settings                 always a route
```

Third time the restricted alphabet has paid for itself: it made the hyphen an
unambiguous slug delimiter (D33), and now makes `~` a permanently safe prefix.
A UUID or base62 id would have needed a separate escaping rule for both.

---

## D35 — Text nodes, capped at 2000 characters

**2026-08-19 · settled**

Double-click empty canvas to create one; double-click a node to reopen it.
Pasting text creates one at the pointer. Images win when the clipboard carries
both — a screenshot copied from a browser usually drags its alt text or source
URL along.

Text lays out at **automatic height**: `w` is the wrap width and authoritative,
`h` is a cached measurement. Resize therefore moves one axis only; dragging a
height would either be ignored or clip the content. Images stay aspect-locked.

Content and its measured height commit as **one Change**, since a patch is a
list. Committing the height separately would put an entry on the undo stack that
the user never performed.

An empty text node is discarded on blur rather than left behind: it renders
nothing, so it would be invisible and unselectable but still on the board.

**2000 characters, then an ellipsis.** A board is a spatial reference tool, not a
document editor — a whole article becomes a node unreadable at any zoom that
still costs layout every frame. Truncating keeps a paste recognisable as what it
came from while staying a glanceable card.

---

## D36 — Noto Sans at weight 700

**2026-08-19 · settled**

Loaded from Google Fonts: `Noto Sans` for the Latin UI and `Noto Sans TC` for
the zh-TW translations, so both scripts render in one design instead of falling
back to whatever each system supplies.

Only weight 700 is fetched, and it is the body default, so there is a single
font file per script and no weight the design does not use.

Trade-off accepted: an offline or CDN-blocked visitor falls back to the system
sans stack. Nothing about the layout depends on the webfont loading.

---

## D37 — Text size is four presets

**2026-08-19 · settled**

12, 16, 24 and 40 world units, offered on a floating island when exactly one
text node is selected.

Presets rather than a free number: a reference board wants a few distinguishable
levels — heading, body, caption — not arbitrary values that make two notes look
accidentally different.

The control hides when the selection is empty or holds more than one node, since
it would otherwise be unclear which node the buttons act on. `⌘⇧>` and `⌘⇧<`
step through the presets and, unlike the buttons, apply to _every_ selected text
node in a single Change — a keyboard shortcut has no ambiguity about its target.
Both the shifted spelling (`>`) and the unshifted key (`.`) are accepted, since
layouts differ in which they report.

It sits at the **end** of the control row. A control that comes and goes must
never shift the position of the permanent ones.

Changing size is one undoable Change. The node's cached `h` goes stale until the
text is next edited, which costs nothing: text renders at automatic height and
nothing reads `h` for layout.

## D38 — The grid is a layer, not a background on the surface

The dot grid fades out once its on-screen spacing drops below 6px, which at a
24px world spacing means below 25% zoom. It was painted as a background on the
canvas surface, so fading it faded the surface's descendants too — the whole
board went blank at exactly the zoom where an overview is most useful.

The grid now renders as its own `pointer-events-none` layer behind the scene.
Opacity on decoration must never sit on an element that also has content
beneath it.

Reverses if: the grid stops being a plain CSS background — a canvas-drawn or
tiled grid would want its own compositing story anyway.

---

## D39 — The OCR queue is one job deep

**2026-08-19 · settled**

The main thread sends one image to the worker and waits for its answer before
sending the next.

The mock finishes in single-digit milliseconds and would not care. A real
engine holds a model plus its intermediate tensors, and running several images
at once multiplies that by the number in flight for no throughput at all — the
worker is one thread either way. Serialising also makes `queued` and `running`
honest states rather than decoration.

Reverses if: recognition moves to several workers with a shared model, at which
point the queue depth should match the worker count.

---

## D40 — Only terminal OCR states reach disk

**2026-08-19 · settled**

`done` and `failed` are written to the Asset record. `queued` and `running` are
memory-only.

A stored `running` would outlive the run that produced it: after a reload there
is no job behind it and no code path that resolves it, so the image would sit
at a spinner forever. The states that describe work in progress belong to the
session doing the work.

A stored `done` is never recomputed — that is the entire reason for persisting
it. A stored `failed` is retried once per session, since the failure may have
been the tab running out of memory rather than anything about the pixels.

Reverses if: recognition becomes resumable, in which case a persisted progress
value is worth something.

---

## D41 — The mock recognizer reads real ink

**2026-08-19 · settled**

`MockRecognizer` projects the image's ink onto both axes to find lines and
words, and only invents the _strings_. It does not emit boxes on a grid.

The mock exists so the selection overlay can be built and judged before an
engine exists (step 7 precedes step 9). An overlay is only judgeable when its
highlights sit on real glyphs — boxes on a grid would make every overlay bug
invisible and every correct overlay look wrong.

Word splitting is read off each line rather than from a fixed ratio of the line
height. Measured on a 34px bold sans line, spaces were 9px and letter gaps 3px,
either side of any ratio worth guessing; sorting the line's gaps and cutting at
the widest jump between consecutive values separates the two clusters without
knowing the font.

Boxes are seeded by the asset id, which is the content hash, so the same bytes
always produce the same fake reading and a reload does not reshuffle anything.

Reverses if: a real engine lands. The mock stays as a test fixture, not as a
fallback — a fallback that invents text would be worse than an error.

---

## D42 — Double-click enters a node

**2026-08-19 · settled**

Double-clicking a text node edits it; double-clicking a recognized image makes
its text selectable. One gesture, one meaning: go inside this node.

An image being read does not drag, because the same drag is how its text gets
selected, and the board's keyboard shortcuts are suspended while it is entered
so Delete and Select All apply to the text rather than to the board. Escape
leaves, as does a press anywhere else — including on another node, since only
one overlay may be selectable at a time.

The alternatives were a modifier key and a mode toggle in the chrome. Both add
something to learn for a gesture the app already had a meaning for.

Reverses if: images grow a second inside-the-node action, at which point
double-click has to choose between them.

---

## D43 — The overlay positions lines, not words

**2026-08-19 · settled**

A line is one absolutely positioned block spanning the overlay's full width;
its words are `inline-block` in normal flow, placed by margins and pinned to
their measured widths.

The obvious construction — every word its own absolutely positioned box — looks
identical and breaks selection. Measured: a drag that ended **five pixels** past
the last glyph collapsed the whole selection, and a drag downward across lines
selected nothing at all. With everything out of flow there are no line boxes to
extend along, so a pointer that is not directly over a glyph has no text
position to reach for. Nobody releases the mouse exactly on the final letter.

With real line boxes the same drags select what they look like they select, an
overshoot of 150px still lands at the end of the line, and a drag down the image
selects across lines.

Two details carry their weight:

- Lines are stretched full width and pushed in with `padding-left` rather than
  positioned at the first word, so an overshoot to the right stays inside the
  line's own box.
- Each line sits inside an in-flow wrapper, so a block boundary separates them
  and a copied selection comes back with its line breaks.

Reverses if: the overlay ever needs per-word rotation, which flow cannot express.

---

## D44 — Word widths are measured in the DOM, at the size they will render

**2026-08-19 · settled**

Each word is measured by laying it out offscreen at its real font size, in one
batched pass, using the same class the real spans carry.

Three attempts, in order:

1. `canvas.measureText` — about 1% off what the same font rendered as a span.
2. DOM at one reference size, scaled linearly — still drifted, because glyph
   advances are not linear in font size; hinting rounds them at small sizes,
   worth about 2% on short words.
3. DOM at the real size — exact.

Measuring at the real size costs nothing extra, because these font sizes are in
world units: panning and zooming do not change them, only resizing the node
does.

Two traps were paid for along the way:

- **`document.fonts.status === "loaded"` is not a font-loaded check.** It is
  true whenever nothing is _pending_, including before the page has asked for
  the font. Measuring then captured the fallback's advances and nothing
  invalidated them — every span came out ~1.5% wide, intermittently, only on a
  cold font cache. The overlay now calls `document.fonts.load()` for the face by
  name and re-measures when it resolves, in addition to watching `loadingdone`.
- **Probes must be taken out of flow.** Laid out as inline siblings on one line
  each probe starts at a fractional x-offset and its glyphs snap to it, moving a
  measured width by half a pixel — the same order as the error being corrected.

Reverses if: the overlay adopts a font with no webfont dependency, which removes
the loading race but not the measurement.

---

## D45 — Weights are fetched from Hugging Face and cached in IndexedDB

**2026-08-19 · settled**

PP-OCRv5 mobile detection and recognition are downloaded from the official
`PaddlePaddle/*_onnx` repositories on first use, then cached in an IndexedDB
store.

The research notes said the official Hugging Face repositories carried only
Paddle's own `.pdiparams`, which is why third-party ONNX mirrors were the
assumed route. That is no longer true — `PP-OCRv5_mobile_det_onnx` and
`PP-OCRv5_mobile_rec_onnx` publish `inference.onnx` under Apache-2.0, served
with `access-control-allow-origin: *`. Measured: 4.83 MB and 16.53 MB. The
question of trusting a one-maintainer mirror does not have to be answered,
because it no longer has to be asked.

Cached in IndexedDB rather than left to the HTTP cache: an evictable cache is
not something to bet a 21 MB download on, and on a miss it happens again with
nothing to show that it did.

The character list is generated into the repo instead, by
`scripts/extract-charset.mjs`, from the same model's own `inference.yml`. It is
111 KB, so nothing is gained by fetching it, and taking it from the model's
config rather than a loose `ppocrv5_dict.txt` means the labels cannot drift
from the weights. The script asserts the count: 18383 entries, plus a blank and
a space, is exactly the graph's 18385 output classes.

Reverses if: Hugging Face stops allowing cross-origin reads, at which point the
weights have to be mirrored somewhere this project controls.

---

## D46 — The engine is chosen by `?engine=mock`

**2026-08-19 · settled**

The real recognizer is the default. `?engine=mock` selects the fake one.

The end-to-end suite runs on the mock, so it stays fast and offline and asserts
the same fake reading every time. One opt-in spec, gated behind
`E2E_REAL_OCR=1`, runs the real engine and asserts it actually reads — both a
34px page and 13px light-on-dark UI text, which is the case this app exists for.

The mock is not a fallback. If the real engine fails, the asset fails (D40) and
says so; inventing plausible text when recognition is broken would be worse
than an error, because it looks like success.

Reverses if: the suite gets a reliable way to serve the weights locally, which
would make running the real engine everywhere cheap.

---

## D47 — Detection returns axis-aligned boxes only

**2026-08-19 · settled**

The DB postprocess flood-fills the thresholded probability map and takes each
region's bounding box. It does not fit minimum-area rectangles.

PaddleOCR fits rotated quads. Nothing downstream can use one: a `Word` is an
axis-aligned box in asset space, and the overlay renders unrotated spans, so a
rotated result would be squared off anyway. Screenshots — the case this app is
for — have no rotation to recover.

Thresholds come from the model's own `inference.yml` rather than a port's
constants: threshold 0.3, box score 0.6, unclip ratio 1.5. For an axis-aligned
box the unclip reduces exactly to offsetting each edge by
`area x ratio / perimeter`.

**Two expansions, not one.** DBNet predicts a _shrunk_ region, so the raw
detection is smaller than the glyphs and every usable box is an expansion of
it — but the crop and the highlight want different ones. Measured against ink at
y 45.3..77.2 on a 34px line:

```
raw region          y 51..69     what the network actually outputs
x1.5  (PaddleOCR)   y 37..83     what gets cropped and read
x0.84 (this)        y 44..76     what a Word reports
```

The reading crop keeps PaddleOCR's generous 1.5, because a crop that clips
ascenders costs accuracy and slack costs nothing. The reported box uses
`1 - 0.4^2`, which is the training-time shrink read backwards — DBNet's labels
are offset inward by `area x (1 - 0.4^2) / perimeter`, so expanding by the same
quantity inverts it. It is the recipe, not a number tuned until the highlight
looked right.

Reporting the crop box instead put the highlight 8px proud of the text on every
side, which is what it looked like: a bar floating above the words.

Reverses if: photographed pages become a real use case, which needs the rotated
quad, a warp in the crop step, and a rotation on the span.

---

## D48 — Words come from CTC timesteps, split only at spaces

**2026-08-19 · settled**

Detection finds lines, not words. Each line is split into words using the
timestep each character was decoded at: a CTC head reads a line left to right
in T slices, so the slice a character survives in says where in the line it
sits.

Without this a line would be one `Word` holding a whole sentence, and selection
granularity would be the line — double-clicking a word would take the sentence.

Split **only at real spaces**, never per character. Chinese writes without
them, so a per-character split would be right for selection and wrong for
everything else: the overlay puts a space between consecutive words, and
copying a Chinese line would come back with a space between every character. A
CJK line stays one `Word`, which costs selection granularity and keeps the copy
correct.

**Words are tiled, not trusted.** A CTC head marks a character in the single
slice it fires in, which sits late and spans less than the glyph: measured,
words came out about 30% narrower than their ink and drifted left. So the
timesteps are used for the _boundaries between_ words — each word extends to
meet its neighbour halfway, and the outer two reach the ends of the line's box.
That also matches what selecting text looks like, since a real highlight covers
the spaces between words too.

The overlay measures each word's separating space into its box for the same
reason. Left to overflow, the space paints its own selection rectangle on top of
the tiled neighbour, and two translucent highlights stack into a dark seam at
every word boundary.

Reverses if: the overlay learns to distinguish a word break from a character
break, at which point CJK can be split per character and joined without spaces.

---

## D49 — Build identity is inlined from git, not written down

**2026-08-19 · settled**

`vite.config.ts` inlines the commit, the build time, and the installed
`onnxruntime-web` version through `define`. Nothing is maintained by hand.

A version constant someone has to remember to bump is a version constant that
eventually lies, and the whole point of the panel is to answer "what is
actually running". Git failing — a shallow checkout, a tarball — falls back to
`"unknown"` rather than throwing, since a build should not fail for want of a
label. A dirty tree gets a `+`.

Reverses if: the project starts tagging releases, at which point `git describe`
says more than a bare SHA.

---

## D50 — The real recognizer is a separate chunk, and workers build as ES

**2026-08-19 · settled**

`src/ocr/worker.ts` imports `PaddleRecognizer` dynamically, and
`vite.config.ts` sets `worker.format: "es"`.

Measured in the production build:

```
worker chunk              192 KB   ->  2.95 KB
paddle-recognizer chunk        —   ->   188 KB, fetched on demand
```

The second half is not optional. Vite builds workers as IIFE by default, and an
IIFE bundle has nowhere to put a dynamic import, so Rollup inlines it — the
split appears to be written, the build succeeds, and the chunk is exactly as
large as before. It was only visible by reading the build output.

Traced end to end, in the production build:

```
idle                  nothing at all, not even the worker
?engine=mock, paste   worker chunk only
default, paste        worker, recognizer, both graphs, the wasm runtime
```

Reverses if: the mock is retired, at which point the recognizer is the only
engine and the extra round trip buys nothing.

---

## D51 — There is a third way to add an image

**2026-08-19 · settled**

A file picker, bottom right, always visible.

Paste and drop are both desktop gestures. A phone has no drag source and iOS
gives a web page no usable paste, so without this the app is a viewer on every
touch device — which is most of the devices a screenshot is taken on.

Shown everywhere rather than behind a media query: "add a picture" is not a
worse idea with a keyboard attached, and a control only some people can see is
a control nobody documents. `accept="image/*"` is what makes a phone offer the
camera and the photo library instead of a file tree.

It routes through the same `ingestFiles` as paste and drop, so what arrives is
one undo step and gets recognized like anything else rather than being a second
class of image. The input's value is cleared after each pick, or choosing the
same file twice in a row fires no change event and the button looks broken.

Reverses if: nothing foreseen. This is the only way in on a phone.

---

## D52 — Images gain a WebP beside them, in the background

**2026-08-19 · settled**

Every pasted image keeps its original bytes and, once a worker has finished,
gains a WebP re-encode at the same dimensions. The original is what renders and
what the id was hashed from. The WebP is what sync will send.

Nothing waits for it. The node is on screen from the bytes that arrived, and if
the encode never happens — an old browser, an encoder that refuses — the app is
exactly as it was.

**Dimensions are never touched.** A screenshot that has been quietly downscaled
is a screenshot whose text cannot be read back, which is the one thing this app
is for.

Measured on a 900x210 dark-theme UI screenshot at 13px, read back with the real
recognizer:

```
png        29,364 B   read 18/20
webp@0.7    8,188 B   read 19/20
webp@0.8    9,528 B   read 19/20
webp@0.9   12,278 B   read 19/20
webp@0.95  14,720 B   read 19/20
webp@1     37,924 B   read 18/20
```

Recognition does not care — every WebP read the same, and slightly better than
the PNG, so the accuracy worry this measurement existed to settle is not the
constraint. Quality 1 is a trap: lossy WebP at maximum quality is _larger_ than
lossless PNG on flat UI colour, so the setting that sounds safest costs bytes
for nothing. 0.9 is 2.4x smaller with no visible artifacts, which matters
because on a synced device the WebP is what gets displayed.

Three things are skipped: images under 24 KB, where the format's overhead makes
it a wash; images already in WebP, since re-encoding lossy to lossy compounds
artifacts and the bytes are already in the format sync wants; and any result
that came out larger than its input.

Its own worker, not a job on the OCR one. That queue is one deep by design and
its first job can spend a minute fetching 21 MB of weights — compression behind
it would mean the first image on a fresh browser stays uncompressed until the
model lands.

### Whether a worker is needed at all

`OffscreenCanvas` is not a threading primitive. It is a canvas that _can_ exist
where there is no DOM; the off-main-thread part comes from the worker. But how
much that buys was assumed rather than measured, so: measured, in Chrome, by
timing each phase separately.

```
1000x700    decode 2ms    drawImage 0ms    encode  34ms
3000x2000   decode 10ms   drawImage 2ms    encode 199ms
6000x4000   decode 43ms   drawImage 15ms   encode 742ms
```

Only `drawImage` is synchronous. `createImageBitmap` and `convertToBlob` are
promises that Chrome already services on its own threads — 742ms of encoding on
a 24-megapixel image costs the calling thread nothing. Running the whole thing
on the main thread cost a worst frame gap of 26ms against the worker's 18ms.

So the worker buys about 15ms at the extreme and about 2ms in practice, which is
not the reason to have one. The reasons that survive:

- **Memory.** A 6000x4000 RGBA bitmap is 96 MB, and the canvas backing it is
  another 96 MB. In a worker that lives and dies away from the main thread's
  heap, next to neither React nor the OCR overlay.
- **The other browsers.** Only Chromium was measured, because only Chromium is
  installed here. Nothing guarantees Safari or Firefox service `convertToBlob`
  off the calling thread, and the main-thread version has no floor if they do
  not.

Kept on those grounds, not on the throughput grounds it was written for. Passing
a `Blob` across the boundary is free either way — structured clone moves a
handle, not the bytes.

Reverses if: storing both copies becomes the expensive half. The original could
then be dropped once its WebP exists, at the cost of never being able to prove
what was pasted.

---

## D53 — Google sign-in exists; sync does not

**2026-08-19 · settled**

`src/sync/` holds the token flow and a Drive REST client. Nothing is uploaded
or downloaded, and the info panel says so in as many words while signed in.

The transport is the easy half and the merge is the hard one (docs/sync.md).
Shipping the easy half alone is fine as long as it does not pretend: a sync that
half works is worse than none, because a board that looks backed up and is not
is only discovered on the day it matters.

Specifics worth keeping:

- **Tokens live in memory only.** `localStorage` survives a reload, which is
  exactly what makes it wrong for a bearer token — any script on this origin can
  read it and it outlives the tab that earned it. An hour of silent re-consent
  is cheaper.
- **The Google script loads on demand**, not from `index.html`. It is a
  third-party request on every page load for a feature most sessions never
  touch, and this app opens straight onto a board.
- **Drive is called over `fetch`**, not through Google's JS client. The surface
  is four endpoints; the library is 100 KB and a second third-party script.
- **A build with no client id says so** and offers no button. A sign-in that
  cannot work is worse than none, and one that silently vanishes is a mystery
  for whoever debugs it later.

Reverses if: sync grows past what four endpoints can express — resumable
uploads for very large assets would be the first sign.

## D54 — Left-drag on empty canvas selects; panning moves to space and the middle button

**2026-08-19 · settled**

A drag from empty canvas draws a selection box, and every node it _touches_ is
selected. Contact rather than containment: a marquee that demands full
containment cannot pick up the large screenshot that runs off the edge of the
view, which is most of them.

This takes the button that used to pan, so panning now has three ways in:
two-finger scroll (unchanged, and the one most sessions use), middle-drag, and
space+drag. That is the binding Figma, Excalidraw and Miro all share, so the
muscle memory arrives with the user.

Specifics worth keeping:

- **One finger still pans.** Touch has no middle button and no space bar, so a
  lasso on touch would leave a phone with no way to move around the board. The
  pan handler tests `pointerType === "touch"` for exactly this.
- **The pan key is module state, not store state** (`src/canvas/pan-key.ts`).
  Its two readers are native pointerdown handlers that ask once, at the instant
  of the press; nothing renders from it, so putting it in a store would
  re-render the canvas twice per key press to answer a question no view asks. It
  resets on `blur`, because a key released in another window never reports back
  and a stuck pan modifier silently disables selection.
- **A 3px threshold separates a click from a drag.** Below it no box appears and
  no selection changes, so a click that drifts on a trackpad still reads as a
  click.
- **The marquee is not board state.** It lives in the hook, in world
  coordinates, and never reaches a Change — drawing a box is not an edit (D17).
- **Shift-drag adds.** Which is why the press that clears the selection now
  skips when a modifier is held: it used to run first and empty the selection
  the additive lasso was about to extend.

Reverses if: a tool palette arrives. With an explicit select/pan mode, the
modifier gymnastics stop earning their keep and the button follows the mode.

---

## D55 — Paint order is a fractional index per node

**2026-08-19 · settled · supersedes [D18](#d18--paint-order-is-array-order-nodez-does-not-exist)**

Every node carries an `order: string`, and the board paints in `(order, id)`
order. The array is still kept sorted, so everything that reads it goes on
reading paint order out of an index — but the key is what is authoritative and
what survives being written on two devices.

This landed _before_ sync rather than during it, deliberately. Array position is
not mergeable: append a node on the laptop and another on the phone and you have
two arrays whose last elements disagree, with no operation that recovers either
intent. Every board written without keys is a board that needs migrating later,
and the migration is guesswork once two devices already disagree — so the cost
of waiting grows with every day of use, while the cost of doing it now is one
afternoon on a handful of boards.

Specifics worth keeping:

- **The algorithm is Greenspan's**, the one Figma and Excalidraw use: a head
  character encoding the length of the integer part, then an optional fraction.
  The structure exists to keep repeated appends at constant length — `a0`, `a1`,
  … `az`, `b00`. A fraction-only scheme is half the code and creeps a character
  longer every few appends, forever; 5000 appends reach four characters here and
  several hundred there.
- **Written by hand, not installed.** It is one pure file with no imports and a
  published specification, which is the profile of a dependency that costs more
  to keep than to own.
- **Ties break by id.** Two offline devices inserting at the same place mint the
  _same_ key. Without a second term each board would paint them in whatever
  order its array happened to hold, which is precisely the disagreement keys
  exist to remove.
- **`insertNodes` mints the keys**, not the code that builds the node — only it
  can see where the new node lands relative to the board. Node constructors
  return `NewNode`, a node minus its `order`, so a node with no place is a type
  error rather than a runtime surprise.
- **No patch op names a position.** `insert` carries its key on the node,
  `remove` carries the whole node, and restacking is a new `order` op. This is
  also what makes the delete inverse simpler than it was: a node knows where it
  goes without anything having to remember the index it came from.
- **Migration runs on every hydration, not once.** A board can arrive from
  IndexedDB now and from Drive later, and one written by an older build on
  another device is not a case that ever stops happening. Missing keys are
  filled from the stored array order, which _was_ the paint order.

Reverses if: nothing plausible. If sync is abandoned the keys are harmless; the
cost is one `order` field and one pure module.

---

## D56 — Boards merge per node, against a stored base

**2026-08-19 · settled**

Nodes carry `updatedAt`, deletions leave tombstones, and `mergeBoards` is a pure
function that takes two versions of a board and the last version both devices
agreed on.

Per-board last-writer-wins was the obvious answer and it is wrong: two devices
that each add one image produce two whole-board writes, and whichever lands
second erases the other's image. On two devices that is Tuesday, not an edge
case.

Specifics worth keeping:

- **The merge is symmetric, and that is the property everything rests on.** The
  laptop merges `(local, remote)` and the phone merges `(remote, local)`. If
  those disagree, each push convinces the other device it is stale and the two
  ping-pong forever. So no rule breaks a tie by looking at which argument it was
  handed — ties break on content and on ids, which both devices read alike.
- **Stamps are applied by `applyPatch`**, from one clock reading per change, so
  commit, undo and redo all stamp identically. An undo restamps: from the sync
  layer's side an undo is an edit, and a node that kept an older stamp would
  lose the next merge against the very change it was undoing.
- **A base turns two-way into three-way.** Without it the merge can see that two
  copies differ but not which side did the differing — a deletion on one device
  and an edit on the other are indistinguishable. The base is the last merged
  board, kept in its own IndexedDB store.
- **Text edited on both sides keeps the loser beside the winner.** There is no
  correct answer without a CRDT, and a CRDT would end the inverse-patch history
  (D15). Ugly, visible and recoverable beats silent and correct-looking. The
  rescued copy's id is _derived_ from the loser, not generated: a random id
  differs on the two devices, and each sync would treat the other's rescue as a
  new node. That was a real bug, caught by merging twice — one lost paragraph
  became two, then three.
- **Images are not rescued.** A picture moved on both devices has one rectangle
  or the other; a duplicate image is litter.
- **A merge lands as an ordinary Change**, with stamps preserved. History is
  in-memory (D16), so a merge that bypassed it would leave the undo stack and
  the board disagreeing about what happened.
- **Sync never runs on a board that is still hydrating.** It looks empty, and an
  empty board against a base with nodes reads as "this device deleted
  everything" — which would then be pushed, and would look deliberate.
- **The asset sweep now counts synced boards as reachable.** A board living only
  on another device made its images look orphaned. Sync bases are enough to
  cover it: an asset is only on this disk because this device made it or
  downloaded it, and downloading it means a base exists.

Reverses if: two people ever edit one board. Then the text rule stops being
tolerable and a CRDT — with the history rewrite it implies — becomes the honest
answer.

---

## D57 — Sync has a transport seam, and a fake remote behind it

**2026-08-19 · settled**

`SyncTransport` is six methods. Two implementations: Drive, and a second
IndexedDB database on this machine, selected with `?sync=fake`.

Written the day Google Cloud Console would not create an OAuth client. That is
the shallow reason; the real one is that the merge is the part worth building
carefully and it should never have been blocked on someone else's signup form.
The fake runs the same loop, the same merge, and the same asset transfer, with
the network swapped out.

The same reasoning gave OCR its mock recognizer, and the same rule holds: one
module names a concrete implementation, and it is `use-sync.ts`.

Specifics worth keeping:

- **A separate database, not another store in `canwas`.** The point is that it
  is somewhere else. Sharing the app's own database would let a bug in the loop
  read local state, call it remote, and pass the test.
- **The fake returns its boards through `JSON.parse(JSON.stringify(...))`**,
  because Drive hands back parsed JSON and any difference between the two is a
  difference the loop would eventually come to depend on.
- **Drive folder ids and listings are cached per session.** Drive has no path
  lookup, so reaching `CanWas/assets/<hash>.webp` is three queries every time;
  caching turns twenty assets from sixty requests into one listing.
- **Assets go up before the board does.** A board referencing an image the
  remote does not have is a board another device renders with a hole in it, and
  the window between the two writes is when a phone is most likely to be closed.

Reverses if: the fake stops being exercised. A seam kept for a second
implementation nobody runs is just indirection.

## D58 — Floating chrome is glass, from two shared classes

Every widget that floats over the board is translucent and blurred: a 20px
backdrop blur with a saturation boost, a neutral-900 tint under it, and a bright
hairline along the top edge. Two classes in `index.css` — `.glass` for controls,
`.glass-strong` for anything holding paragraphs — and nothing assembles its own
background, border and shadow.

This replaces a rule that said no shadows, which the app had already stopped
following: there were `shadow-lg`, `shadow-xl` and `shadow-2xl` in the chrome,
under four different background opacities, and nobody had chosen any of them.
Glass is the same idea the old rule was reaching for — chrome that recedes and
reads as above the board rather than as a second board — stated once instead of
re-improvised per component.

Why a CSS class rather than Tailwind utilities, against [D10](#d10--no-tailwind-theme-extension):
D10 is about not registering theme tokens, and this registers none. A
`backdrop-filter` carrying two functions has no utility, and repeating five
utilities at nine call sites is how the four opacities happened. Radius stays in
the markup, because a panel and a control genuinely differ there.

The strong variant is not decoration. `.glass` over a screenshot of a white page
is a pale smudge, so anything that can float over _content_ rather than over the
canvas takes the heavier tint — today that is the recognition badge.

Reverses if: the blur costs real frames on a full board. `backdrop-filter` is
per-element and composited, and a board is a dozen widgets, not a thousand — but
a badge per image is the one that could grow.

## D59 — Paste sizes nodes at their own size, corrected for density

**2026-08-20 · settled · supersedes [D19](#d19--paste-sizes-nodes-to-fit-the-viewport)**

A pasted image lands at its own pixel size, divided by the density its file
claims. Nothing is fitted to the viewport, in either direction.

D19 scaled every paste to at most 40% of the visible canvas, to dodge exactly
one problem: retina screenshots are 2x and would otherwise land at double the
size they appeared. That fixed the symptom by overriding the size entirely,
which costs more than it saves.

- **It was not deterministic.** The same screenshot pasted at two zoom levels
  came out at two sizes, and D19 said so.
- **It destroyed the comparison the app is for.** A board of screenshots is
  read by putting two of them side by side. Fitting each to the window makes a
  full-page capture and a cropped detail the same width, which is the one
  relationship worth preserving.
- **It never actually corrected the density**, only hid it. Under the clamp —
  a small capture, a button or a toast — the 2x error came through untouched,
  so the same UI element pasted at two sizes depending on which machine took
  the screenshot.

The density now comes from the file's own `pHYs` chunk, which is what macOS
`screencapture` writes, rather than from `devicePixelRatio`. Two reasons: the
machine pasting is not always the machine that captured, and a large photo is
not a 2x anything — dividing every image by the current display's ratio would
shrink real content for no reason. Only whole-number multiples of the 72 and 96
DPI baselines count as density; a 300 DPI scan divides into neither and is left
at full size, which is right, because it is a big image rather than a small one
recorded densely. An image that says nothing is taken at face value.

**Known cost, accepted:** a 10000x10000 paste is now a 10000x10000 node, and at
100% zoom the window shows a corner of it with no sign that anything landed.
This is expected behaviour rather than a bug — the zoom controls are right
there, and the alternative was resizing every ordinary paste to protect against
an unusual one.

## D60 — Recognition syncs, and every remote document carries a version

**2026-08-20 · settled**

`text/<sha256>.json` beside `assets/<sha256>.<ext>`, holding the words read out
of those bytes and the name of the engine that read them. Every JSON document
written to a remote — boards included — carries a `_version`.

Recognition is the cheapest thing in the sync to share and the most expensive
not to. It costs 21 MB of weights and real seconds of CPU to produce, and it is
a pure function of the bytes; the id _is_ the hash of those bytes, so the same
id is the same pixels on every device, forever. It also cannot conflict — two
devices that read the same image did not disagree about anything — so it needs
none of the merge machinery a board needs. First writer wins.

Its own folder rather than a second extension in `assets/`: `hasAsset` answers
by filename prefix, so `<hash>.ocr.json` sitting beside the image would make a
picture nobody has look present.

Two guards, both learned rather than assumed:

- **Only a finished reading is published.** A failure belongs to the device that
  had it, and uploading one would stop every other device from trying.
- **The engine is recorded and checked on the way in.** The mock recognizer
  invents its strings. One `?engine=mock` session would otherwise write
  plausible nonsense that every real build would adopt in preference to reading
  the image itself — the one way this feature could quietly ruin a board.

Recognition is pulled before the images, so a downloaded asset is stored already
read. The obvious order — bytes first, words after — puts an unread asset in the
store, and `useOcr` enqueues it on the very next render: the device pays the full
cost anyway and then overwrites the arriving reading with its own.

The `_version` stamp is not for today's format. Devices update independently, so
a phone unopened for a month runs last month's code against what a laptop wrote
this morning. An old build reading a new document does not fail cleanly, it
half-succeeds — keeps the fields it knows, drops the rest, writes it back — and
the write destroys the evidence. Stamp on the way out, refuse on the way in;
refusing to read is also refusing to overwrite. A missing stamp is version 0,
which is what already-written boards carry, and they are stamped on their next
write.

Reverses if: readings grow large enough to be worth compressing or chunking. A
dense page is a few hundred words of JSON today, which is smaller than the image
it describes by a wide margin.

## D61 — Every board reconciles once per connection, in records mode

**2026-08-20 · settled**

`reconcileBoards` walks the union of local and remote boards when a transport
appears. Connecting had meant "back up the board I am looking at", and a board
made elsewhere never appeared here at all.

Once per _connection_, not per navigation: it is the one operation that touches
everything, and running it each time a board is opened would make browsing
expensive.

Boards that are not open sync in `records` mode — push the record, push the
images, download nothing but the record. Images are the only thing in this app
that cannot be recomputed, so they go up straight away; pulling them down for a
board nobody is looking at is speculative traffic, and the missing-asset
placeholder already handles a node whose picture has not arrived.

The skip is the part that makes it affordable. `putBoard` repeats the board's
`updatedAt` into Drive `appProperties`, so the folder listing taken at session
start answers "which of these changed" for every board at once, and an unchanged
board costs zero requests. Agreement must be unanimous across local, remote and
base; an absent stamp means ask, because a board written before this existed has
none and would otherwise be skipped forever.

The open board is excluded, and the exclusion is re-checked for every board
rather than captured once — the pass outlives a navigation, and two writers on
one board, one from atoms and one from disk, is exactly the race it exists to
avoid.

Reverses if: boards get large enough that a listing no longer settles the
question, or a change feed becomes available.

See `docs/sync-limits.md` for what this costs in Drive quota units and where it
still breaks.

## D62 — Tabs tell each other, and opening a board is not an edit

**2026-08-20 · settled**

A `BroadcastChannel` carries `{kind: "board", boardId, updatedAt}` and
`{kind: "boards"}` between tabs on this origin. A tab that hears its board moved
reloads it from IndexedDB; a tab that hears the list moved re-reads the list.

The message carries no board content, deliberately. It can arrive twice, arrive
late, or be dropped, and IndexedDB remains the only source of truth — a payload
would be a second copy of the board that could disagree with the first.

The problem it solves is not a merge problem. Two tabs are two sets of atoms
over one database, and each writes the whole board record when it saves, so a
tab holding a stale node list lands it on top of a newer one. The second tab did
not have to be _edited_ to destroy work; it only had to be open, and then saved.

Two things had to be true for the channel to help.

A tab with unsaved work does not reload. The save is debounced, so there is a
window where the atoms are ahead of the database, and adopting another tab's
record inside it would discard the edit about to be written. "Unsaved" is the
identity of the node array rather than a flag — the atoms hold one array per
board and every edit replaces it, so "the array in the store is not the array I
saved" is exactly the question being asked.

And **opening a board is no longer saving it**. The content effect ran on mount,
saw a node list, and wrote it back with a fresh `updatedAt`. On one device that
only meant "last edited" quietly became "last opened", which is what the board
list sorts by. With two tabs it was the whole bug: the second tab to open a
board stamped its own view as the most recent edit, and nothing could argue with
it afterwards. The node list as it came off disk is now remembered, and a save
happens only once the array is no longer that one.

Reverses if: two tabs need to edit the same board simultaneously without a
winner, which needs the merge, not a channel.

## D63 — PP-OCRv6 small, and the resolution theory that was wrong

**2026-08-20 · settled**

Recognition moves from PP-OCRv5 mobile to **PP-OCRv6 small**: 9.9 MB detection
plus 21.2 MB recognition, against 21 MB for the pair it replaces.

Measured on a photograph of a dense Traditional Chinese form, 3257x3382, ten
structural headings probed:

|                 | boxes | characters | headings found |
| --------------- | ----- | ---------- | -------------- |
| PP-OCRv5 mobile | 58    | 398        | 7 of 10        |
| PP-OCRv6 small  | 68    | 880        | 10 of 10       |

Twice the text off the same pixels. The three headings v5 lost were body-weight
text in paragraphs, which is most of what a document is.

`medium` is the better model and is not the default: 62 MB of detection and 77
MB of recognition is not a thing to make someone download to read a screenshot.
It does share this tier's character dictionary exactly, so it is the only other
tier that could be offered as a choice without shipping a second charset.

`tiny` is 6 MB all in, smaller than what we had, and is **not** a fallback that
can be reached by changing a URL: its dictionary holds 6,904 characters against
small's 18,708. Decoding tiny's output against the wrong table does not fail, it
returns fluent nonsense.

The swap is close to drop-in because the architecture did not change: DB
detection, CTC recognition, ImageNet normalization, recognition height 48. Two
things did. The DB thresholds are the model's own and are looser in v6 (0.2 /
0.45 / 1.4 against 0.3 / 0.6 / 1.5), and the character dictionary grew from
18,383 entries to 18,708. The charset script's class-count guard caught that
immediately, which is what it was written for — a dictionary decoded against the
wrong number of classes does not throw, it returns confident nonsense. The new
count was verified against the graph's own final bias shape rather than taken
from the dictionary it was supposed to be checking.

**The theory that was wrong.** Detection resizes to a 960px long edge, so a
3257px photo is scaled by 0.28 and body text reaches the detector around 8px
tall. That looked like the obvious cause, and raising the edge to 1920 was the
obvious fix. Measured on the same image, it changed nothing: identical 68 boxes,
marginally fewer characters, 20% more time. Reverted. The number stays where
PaddleOCR put it, and the comment there now says it was tried.

Reverses if: 31 MB proves too heavy on a phone, in which case `tiny` is the
next thing to measure rather than a return to v5 — and measuring it means
shipping its dictionary alongside, not swapping a URL.

## D64 — The overlay's line boxes are indented with margin, never padding

Each line of the recognition overlay is one absolutely positioned box, stretched
from its first word to the right edge of the image. The stretch is deliberate
(D-overlay, above): a drag that ends past the last glyph has to land on
something holding a text position, or the selection collapses.

The indent has to be a _margin_. It was padding, which is inside the box — so a
line beginning halfway across an image laid an empty but hit-testable slab over
everything to its left. On a two-column form that is another line of text: the
slab holds no text position of its own, so a press on it selected nothing, and
the line underneath could not be reached at all. Selection was impossible on
exactly the documents this feature exists for.

A margin puts that space outside the box. Nothing else changes — the box still
reaches the right edge, so the overshoot behaviour D-overlay bought is intact.

Reverses if: never. The two are not interchangeable here.

## D65 — Retired model weights are swept at startup

Model ids carry their version so a device holding an older graph cannot read it
out of the cache by mistake (D63). The retired rows were never deleted, and
after v6 landed no code path named the v5 ids again — so nothing would ever have
collected them. A device that had used v5 carried 21 MB of unreachable bytes
behind 31 MB of live ones, and the About panel truthfully reported 50 MB of
weights for a 31 MB model.

`sweepUnknownModels` runs beside the asset mark-and-sweep at startup (D14),
against `KNOWN_MODEL_IDS` — the catalogue, not the selected pair. A tier the
user downloaded and switched away from is worth keeping for the switch back;
only ids the build no longer knows at all are swept.

The engine's name in the About panel is now taken from the same module. It was a
literal in the component and went on reading "PP-OCRv5 mobile" for a release
after the weights beneath it changed, which is the worst possible place for a
stale version number: it is the first thing anyone reads when recognition looks
wrong.

Reverses if: never.

## D66 — Deleting a board marks the record; it never removes it

With Drive connected, deleting a board did not work. `removeBoard` dropped the
row from IndexedDB, the reconcile pass then walked the union of local and remote
boards, found one the remote had and this device did not — and there is no way
to tell "deleted here" from "never seen here". So it downloaded it again. Every
round, forever.

The record therefore stays, carrying `deletedAt`. `isBoardDeleted` decides
whether such a record is a grave or a board, and **every** reader asks it: the
menu, the merge, the reconcile pass, the board screen. A menu filtering on
`deletedAt !== undefined` while the merge compared stamps would hide a board
here that is alive everywhere else.

An edit stamped after the deletion revives the board. That falls out of the same
comparison and is the rule the merge already used across two devices: deleting
on the laptop and pasting on the phone is a real disagreement, and keeping the
board is the answer that can still be undone by hand.

Three things had to be true, and each was a bug on the way:

- **The grave goes into `boardsMetaAtom`, it does not vacate the row.** The
  board's own debounced save reads that atom when its timer fires, and a save
  landing after the deletion would write a board with no `deletedAt` on top of
  the grave. An absent entry makes the save a no-op, which is the same outcome
  only if the timing goes one way.
- **A board with no local record still gets a grave.** A board can be on screen
  before its first save has landed, and it can exist only on the remote and in
  the menu. Refusing to bury what is not on disk hands it straight back.
- **`deletedAt` lives on `BoardMeta`.** Every writer that replaces a stored
  board builds it by spreading a `BoardMeta`, so a field that lives there is
  carried by all of them. This is exactly how node tombstones were lost: three
  hand-written record literals, one of which forgot.

Graves keep their contents for thirty days, then `trimDeletedBoards` empties
them at startup — which is also what releases their images to the asset sweep.
The marker itself is never dropped: a grave removed from disk is a board this
device has never seen, which is where this started.

Reverses if: never, while there is a remote. Without one it would be dead weight.

---

## D67 — The disclosure pages are static HTML, not routes

**2026-08-20 · settled**

`privacy.html`, `support.html` and `licenses.html` are separate Rollup entries
built beside the app. They are not routes, and they share no code with it — not
its stylesheet, not its fonts, not `useTranslation()`.

Three reasons, in order of weight:

- **A hash is not a URL to anyone but a browser.** The app uses hash history
  (D6), so `#/privacy` never leaves the client and is not in the request.
  Google's OAuth consent screen wants a privacy policy URL, and their reviewer —
  like every crawler and link unfurler — fetches it and would get the app shell.
  A policy nothing but a browser can fetch is not a published policy.
- **A disclosure page must not depend on the app booting.** This is what someone
  reads when things went wrong. It ships zero JavaScript, so it renders when the
  router, the worker or IndexedDB does not.
- **It costs nothing against D6.** Hash history exists because Pages 404s on
  deep-link refresh without a `404.html` shim. Real `.html` files have no such
  problem, so these sit beside the router rather than contradicting it, and no
  shim enters the repo.

Both languages are stacked in one document rather than switched. There is no
atom to read, and legal text behind a control is text a reviewer will not read.

The pages link no web font. The app loads Noto Sans from Google's CDN, which is
itself a disclosure the policy has to make — and making that request in order to
render the paragraph disclosing it is the one place it would be absurd.

**The licence list is generated from the build, not from the dependency list.**
`npm ls --omit=dev` names 84 packages here; the bundle contains 21. The
obligation attaches to what is distributed, so `scripts/collect-licenses.mjs`
runs a real build with `write: false` and asks Rollup which modules it touched.
The collector is installed into the worker build as well — workers are a
separate Rollup build with their own plugin container, and without that second
installation `onnxruntime-web`, the largest thing this app ships, is absent from
the list. Three components are appended by hand because nothing could discover
them: the PP-OCRv6 weights (Apache-2.0 — fetching a model at runtime and caching
it is still redistribution) and the two Google Fonts families.

Generated output is committed rather than built on deploy: a filesystem walk of
`node_modules` has no business on the deploy path for a page that changes twice
a year. A test asserts every runtime dependency appears in the page, which is
what fails when someone adds a package and forgets to regenerate.

Two further tests read the source rather than a copied literal: every `https://`
host reachable from the app's own files must be named in the policy, and the
policy must contain whatever `DRIVE_SCOPE` currently is. Widening the scope in
code without editing the policy would turn a paragraph into a false statement —
the one failure in this repo whose consequences are not confined to the app.

Support is **GitHub Issues only**. No email is published; the page says so, and
says that issues are public.

Reverses if: the app ever moves off Pages onto something that can serve routes,
_and_ gains a reason to want these inside the shell. Neither is likely.

---

## D68 — The canvas runs under the cutout; the chrome does not

**2026-08-20 · settled**

`viewport-fit=cover` in the viewport meta, and one `.chrome-layer` element that
carries `env(safe-area-inset-*)` as padding. Every floating island is a child of
it and keeps its plain `top-3` / `bottom-3`, because an absolutely positioned
element is laid out against its containing block's **padding** box — so one rule
moves all of them clear of a notch at once.

The canvas itself is deliberately not inset. A board wants every pixel, and dark
grey behind a punch-hole camera reads as bezel rather than as a mistake. Only
things that can be pressed need to be reachable.

Installed to a home screen there is no browser UI to hide behind, so without
this the top-left island sits under the status bar. That makes it a prerequisite
for [D72](#d72--offline-is-a-generated-service-worker-and-the-update-is-asked-for),
not a polish pass after it.

**Reverses if:** never, realistically. The alternative is letterboxing the app
inside the safe box, which loses screen on every device to protect chrome that
is already clear.

---

## D69 — A press-and-hold on the board is a gesture, not a text selection

**2026-08-20 · settled**

`user-select: none` and `-webkit-touch-callout: none` on the canvas surface,
with `user-select: text` back on `.ocr-word`.

Holding a finger on an image used to raise the OS selection handles and take the
whole canvas — every label, every button — as one blob of text. The callout is
the second half and is iOS-only: Safari offers a copy/share sheet for a held
image even when selection is off.

The exception is not a compromise, it is the point. The recognition overlay is
genuinely text, and long-press is the only way to copy it on a phone; suppressing
it everywhere would have made OCR a desktop-only feature without saying so.

**Known cost, accepted:** entering reading mode no longer selects the whole
overlay as a side effect of the double-click that enters it. That behaviour was
incidental — the surrounding board is now unselectable at the moment the click
lands — and `e2e/overlay.spec.ts` records the change where it used to assert it.

---

## D70 — One finger does one thing, and a bar says which

**2026-08-20 · settled**

Two modes. In **pan**, a press anywhere moves the viewport, including on top of
a node, and a press that ends without travelling more than 5px is a tap that
selects instead. In **select**, a press on a node drags it and a press on empty
canvas rubber-bands.

The chip renders only where `matchMedia("(pointer: coarse)")` matches, live, so
attaching a mouse to a tablet removes it. `currentMode()` returns `select`
unconditionally on a fine pointer: a desktop never sees the chip, and a mode it
cannot see governing its clicks would be a trap.

Why it exists: [D54](#d54--left-drag-on-empty-canvas-selects-panning-moves-to-space-and-the-middle-button)
left touch panning to "drag the empty canvas", which works right up until a
screenshot fills the screen — and a screenshot that fills the screen is the
normal case on a phone. There is no space bar and no middle button to fall back
to.

Module state with a manual subscription, like `pan-key.ts`, because the
consumers that matter are native `pointerdown` handlers registered once. Not
persisted and not part of the board record: it is view state (D17), and syncing
it would mean picking up a phone and finding the mode a laptop chose.

**One bar, not three.** The mode switch, the add-image button and the delete
button share a single pill: three surfaces competing for the bottom of a 412px
screen is how the chip landed on top of the undo island in the first place, and
a thumb that has found the bar should not leave it to add a picture or throw one
away. Delete is last and conditional, so it never shifts the controls that are
always there. The add button keeps its own corner on a mouse, where no bar
exists to hold it.

The bar sits one row above the zoom and undo islands rather than beside them,
for the same 412px reason.

The segments are icon-only — a hand and a marquee, no text. The active one is
`bg-white/10`, not a fixed grey. Inside glass the surface
is tinted and the board moves behind it, so a flat neutral is the one thing in
the bar that does not move with it and it reads as a seam
(docs/ui-guidelines.md).

**The resize handle is select-mode chrome.** In pan mode the press under it
belongs to the viewport, so a handle there is a grip that does nothing — worse
than absent, because it advertises a gesture the mode does not have.

**Select mode never pans.** A left press in select mode belongs to the node or
to the marquee, full stop; panning is the pan key, the middle button, or
switching the mode. Touch was briefly exempted from that so a finger could
always pan — which meant one finger panned the board _and_ drew a selection
rectangle at the same time, because `useLasso` had already claimed the same
press. Two handlers, one gesture, both running.

**Reverses if:** a gesture emerges that separates the two without a mode —
two-finger pan is the obvious candidate, but `touch-action: none` on the surface
means it would have to be implemented by hand.

---

## D71 — A paste that does not fit moves the view, not the image

**2026-08-20 · settled · refines [D59](#d59--paste-sizes-nodes-at-their-own-size-corrected-for-density)**

After an ingest, the batch's bounding box is tested against the current view. If
it already fits, nothing happens. If it does not, the viewport zooms and centres
so the batch fills about 90% of the screen.

The complaint this answers is a phone one: a 4000px screenshot at 1:1 covers the
entire screen with no empty canvas left, so the board can neither be seen nor —
before [D70](#d70--one-finger-does-one-thing-and-a-chip-says-which) — moved. The
obvious fix is to scale the paste down, which is exactly
[D19](#d19--paste-sizes-nodes-to-fit-the-viewport), retired the day before for
destroying the comparison a screenshot board exists to make.

So the size is left alone and the camera moves instead. Node geometry is
untouched, which means nothing here reaches the board record, the history stack
or another device — the viewport is neither undoable nor synced (D17). The
visual result on a phone is identical to fitting the paste; the difference only
shows up when the same board is opened somewhere else, where D19 would have
disagreed with itself and this cannot.

Two details worth keeping: the fit is one per batch rather than per file, so four
dropped screenshots frame as a group; and it never zooms further **in** than the
view already was, because a batch can fail to fit by sitting off to one side and
magnifying a small image for that reason is not what anyone means by "fit".

---

## D72 — Offline is a generated service worker, and the update is asked for

**2026-08-20 · settled**

`vite-plugin-pwa` as a dev dependency, `generateSW`, `registerType: "prompt"`.

Generated rather than hand-written: the precache manifest is built from the real
output, so hashed assets are revisioned and stale caches are cleaned. That
bookkeeping is where hand-rolled workers rot, and a bad cache on a static host
cannot be fixed from the server side — the user would have to clear site data.
The cost is honest: 281 packages in `node_modules` for one config block.

Prompt, never `autoUpdate`. An automatic update reloads the page the moment a new
build is found, and a reload here throws away an initialised ONNX runtime and
31 MB of weights — the most expensive state the app holds, and the one the user
waited longest for.

What is precached: the four HTML entries (D67), the hashed JS and CSS, the
icons. About 1 MB. What is **not**: ONNX Runtime's 13.5 MB wasm, which would be
the larger half of an install that is otherwise ~600 kB and which plenty of
sessions never reach. It is runtime-cached on first use instead, arriving
alongside the weights it needs anyway. The weights themselves stay out entirely
— IndexedDB already holds the copy that survives a reload, and caching 31 MB
twice on a phone is asking to be evicted.

Fonts are runtime-cached rather than self-hosted, which was a deliberate call
with a stated cost: **a cold offline first launch renders in system fallback,
and Material Symbols ligatures show as their own names** — `delete`, `close` —
until the font arrives. Second launch onward is correct. Self-hosting just the
icon font is a ~250 kB reversal that touches nothing else.

`scripts/check-pwa.mjs` runs in `npm run check` and asserts the parts nothing
else can: every document page is precached, no wasm is, the runtime rule exists,
weights are absent, `scope` and `start_url` stay `"."` — an absolute `/` would
claim every other project on the github.io origin.

**Reverses if:** the dependency weight stops being worth it, at which point the
precache manifest is the only piece that genuinely needs generating and
`scripts/collect-licenses.mjs` already proves that shape works here.

## D73 — Two fingers pinch, and outrank whatever the first one started

**2026-08-20 · settled**

The surface is `touch-action: none`, which is what stops the browser from
scrolling the page under a pan — and it takes the browser's own pinch-zoom with
it. That left a phone with no way to zoom at all except the buttons, on the one
device where a screenshot wider than the screen is the normal case.

So the pinch is handled directly, in `use-viewport-controls`, alongside the pan
it already owns: live fingers are tracked in a map, the second one starts a
pinch, and every move zooms about the point between the fingers and pans by how
far that point travelled. Zoom and pan are one gesture on a touch screen —
splitting them makes the board slide out from under the fingers.

A pinch **outranks** the node drag, lasso or tap that the first finger already
started, because by the time the second finger lands one of them is moving
something. They are aborted with a dispatched `pointercancel` — the same event
the platform sends when it takes a gesture over for scrolling, which they all
already handle. Any other rule means an image cannot be zoomed while it is the
thing under the fingers, which on a full-screen screenshot is always.

Lifting one finger ends the pinch and does **not** promote the other to a pan:
that finger has been still while the other did the moving, so handing it the
board makes it jump.

**Reverses if:** the platform ever offers a `touch-action` that allows pinch
while suppressing pan and scroll. `pinch-zoom` exists but restores the visual
viewport, which zooms the chrome too and is not what this needs.

## D74 — A board that cannot reach its remote holds the first edit

**2026-08-20 · settled**

A board that has synced before carries a sync base, which is proof a remote copy
exists. On a reload where nothing can reach that remote, this device edits
blind: it has not read what the other devices did, and every change it makes is
a change the merge has to guess about later. The window is not rare — a Drive
token lasts an hour, so most reloads of a board that has been open a while land
in it, and the sync status reads "off", which looks like an invitation rather
than like something that stopped working.

So the first edit is **held** and the choice is put to the user: _Reconnect and
sync_, or _Edit anyway_. Held rather than dropped, because a mutation here is a
function of the current nodes — replaying it after a pull is correct rather
than stale, and a delete of a node the remote had already deleted replays as
nothing. A paste that silently vanished would read as a bug.

The guard hangs off `useBoardHistory.commit`, which every user edit already
passes through, plus `renameBoardAtom`, which does not go through the history
stack and would otherwise be the one hole — the same hole that let renames skip
sync entirely until the commit before this one. `commit(..., "preserve")` is
exempt: that is how a sync round lands its own merged result, and guarding the
round would hold the very thing the dialog exists to start.

Asked **once per board per session**. "Edit anyway" is remembered in memory and
cleared by a reload, because the next reload is a new chance to be up to date.

**Offline is not one of these states.** No click fixes it, and this app ships a
service worker that promises the board works offline (D72). Only a remote that
is unreachable _while the network is fine_ — expired, signed out, sign-in
failed — raises anything.

Reconnecting has to happen from the dialog's own button, because Google issues
a token only from inside a click; the held edit is released when a round
completes with a timestamp later than the reconnect, not merely when one is
found idle.

**Reverses if:** the interruption grates in daily use. The narrowing that keeps
most of the value is to guard destructive changes only — deletes and renames —
and let moves and pastes through, since a move that merges wrongly is visible
and fixable in a way a delete is not.

## D75 — Copy rides on the clipboard's HTML flavour

Copying nodes writes two flavours through the `copy` event: `text/plain` with
the readable text, and `text/html` holding a single empty `<div>` whose
`data-canwas` attribute carries the payload as JSON. Paste reads the HTML
flavour back, and falls through to the existing text and image paths when the
attribute is not there.

A custom MIME type would be the honest thing to name a private payload, and
Safari drops unknown flavours crossing the OS clipboard — which turns copy into
a feature that works until someone changes browser. `text/html` is a flavour
every platform already carries, and the attribute survives the round trip
because it is markup, not metadata.

`text/plain` alongside it is what makes a copy useful outside the app: pasting a
text node into a message is the text, not a wall of JSON. Images contribute
nothing to it — their recognition belongs to the Asset, not the Node — so a
selection of images writes the HTML flavour alone rather than an empty string
that would blank whatever a text editor pastes.

Both directions are synchronous, on the events. That is D21 again: an app
reading `navigator.clipboard` cannot be driven by a synthetic event, and every
clipboard path here has to be coverable in Playwright.

**No asset travels.** A copied node names its Asset by id, so a paste on the
same device shares the pixels (D13) and one on a device that has never seen them
renders as missing, exactly as an unsynced image does. Copying the bytes would
be a second copy of something content-addressed, which is the one thing the
Asset table exists to prevent.

Pasted nodes land centred on the pointer, keep the relative layout they were
copied with, cascade off whatever already sits at that corner (D71's neighbour),
and arrive selected — a paste is almost always followed by a drag.

**Reverses if:** a browser starts sanitizing data attributes out of clipboard
HTML. The fallback is a custom flavour with the HTML one kept as the
compatibility path.

## D76 — The text being read owns the finger

While a node is in reading mode, a press that lands on its active overlay does
not pan the viewport — for a mouse, and above all for a finger, where a drag
across the words is the only way to extend a selection there is.

Panning from there was not a small annoyance: the board moved under the finger,
so the words being dragged through travelled with it and the selection could
never grow past the point it started at. Reading a screenshot on a phone was
effectively impossible.

The test is on the press target, in `use-viewport-controls.ts`, and it sits
_after_ the pinch has been claimed: two fingers still zoom while reading, since
reading mode has no zoom of its own and a screenshot is read at whatever size
turns out to be legible. Everything else still pans, including a press on the
read node's own margins — outside the overlay is outside the text.

## D77 — A gesture paints the board itself, and words wait to be read

Two changes to what a pan costs, measured on a production build under a 6x CPU
throttle, over 40 pan frames on a board of five recognized screenshots:

|              | before | after |
| ------------ | ------ | ----- |
| Script       | 183 ms | 8 ms  |
| Style        | 5 ms   | 2 ms  |
| Layout       | 0 ms   | 0 ms  |
| DOM elements | 566    | 72    |

Layout was already zero, and it is worth saying why: the scene's `transform`
does not re-lay-out anything under it. Nodes are positioned once in world
units, and pan and zoom are a single composited transform over the top. The
board being "large" costs nothing.

**Where the time went was React.** Every `pointermove` set the viewport atom,
and every set re-rendered the whole canvas — each node, each badge, each word
of each overlay — to change two numbers inside one `transform` string. A phone
reports pointers faster than it draws, so that ran several times per frame.

A gesture now keeps its viewport in a ref and writes the scene transform and
the grid's background onto the elements itself, coalesced to one write per
frame with `requestAnimationFrame`. The store hears once, when the gesture
ends. `src/canvas/grid.ts` holds the single spelling of both properties, since
they are now written from two places and a drift between them would show as a
jump at the end of every pan.

Three things fall out of that and are load-bearing:

- Anything that re-renders mid-gesture — a selection change, a recognition
  finishing, a sync round landing — writes the _committed_ transform back over
  the live one. A layout effect re-asserts the live value after every render.
- Everything else in the app reads the viewport from the store, so a live
  gesture must never be the only place the truth lives for long. It is
  committed at the end of the gesture, and a wheel — which has no end event —
  is committed once it goes quiet, or immediately on the next `pointerdown`,
  whichever comes first.
- Zoom is on the same path, so scale-dependent chrome drawn in world units
  (selection hairlines, the badge's counter-scale) holds its last committed
  scale until the pinch ends. Visible only as a hairline that is briefly the
  wrong thickness while pinching a selected node.

**Second change:** the OCR overlay lays out its words only while its node is
being read. A dense screenshot is several hundred spans of transparent text,
each with its own `scaleX` correction, and they exist for exactly one purpose —
native selection inside the node being read. Outside that they were being
styled, laid out and painted for nobody. The overlay element itself stays
either way; it is what says the text is there.

**Reverses if:** something needs the word boxes without entering the node —
search across a board, say. Then the spans come back, and the way to keep this
is `content-visibility: auto` rather than rendering them all.

## D78 — The camera is a second button, not an option inside the first

`accept="image/*"` was supposed to be enough: it makes a phone offer the
camera alongside the photo library. On iOS it does — the sheet has "Take
Photo" at the top. Android Chrome does not. Its picker is the photo library,
and the camera is reachable only by leaving it for the system file app, which
is a route most people never find. On the device this app is mostly used from,
"add a picture" could not take one.

`capture="environment"` is the attribute that fixes it: the browser skips the
picker and hands the request straight to the rear camera. But `capture`
changes what a picker _is_ — an input carrying it can never also offer the
library — so this could not be the same input with a different label. Two
inputs, two buttons, side by side in the touch bar.

**Touch only.** On a desktop browser `capture` is ignored, so the button would
open a second file dialog identical to the first — a control that lies. It
hangs off the same `(pointer: coarse)` query as the rest of the bar (D70).

Shown on iOS too, where it duplicates one row of the sheet the other button
opens. One tap instead of two is worth a fifth icon, and a control that
appears on one phone and not the other is a bar nobody can describe.

No `multiple`: a camera returns one frame, and the attribute is ignored
alongside `capture` in any case.

Everything downstream is unchanged — the file goes through the same ingest as
a paste, a drop or a pick, so a photo is read like any other image rather than
being a second class of thing.

**Reverses if:** Android Chrome ever puts the camera in its picker, which
would make this button pure duplication on every platform.

## D79 — A board nothing has been done to never leaves the device

Landing on the app with no boards creates one, so the first thing a new device
does is make an empty "Untitled" — and the first thing it did after connecting
was upload it. Sign in on a laptop, a phone and a tablet and the account
collects three empty boards nobody asked for, each one newer than the real
work and therefore at the top of the menu.

`isUntouchedBoard` is the predicate, and all four of its clauses matter:

- **No nodes.** The obvious half, and wrong on its own.
- **No tombstones.** A board whose last image was deleted is empty too, and
  that emptiness is an edit that has to travel or the deletion never reaches
  the other devices. This is what separates the two cases.
- **`updatedAt === createdAt`.** Every edit that leaves no node behind — a
  rename, above all. Naming a board is something you can only do on purpose.
- **Not deleted.** A grave is the one empty board that most needs to go up.

A board materialised from a deep link fails the test deliberately: it is
stamped `updatedAt: 0` precisely because this device has no edit to offer, and
it must still sync in order to be filled in.

**The sync base is the other half**, checked by both callers rather than by the
predicate. Once the remote has seen a board it keeps syncing however empty it
gets — from then on, silence here is a claim about the board rather than an
absence of one. Both upload paths ask: `useSync` for the open board, and the
reconcile pass for every other one, which additionally declines only while the
remote agrees it has never heard of it.

**And the placeholder gets out of the way.** When the pass brings down real
boards, a device standing on an untouched placeholder discards it and opens the
most recently edited board instead — otherwise the first sight of a synced
account is a blank canvas with the work hidden in a menu. It is deleted
outright rather than buried (D66): the remote never had it, so there is nothing
to tell anyone about, and a grave would be pushed up as the deletion of a board
that never existed. Safe by construction — anything at all having happened to
the board makes it a real one, so nothing a user started can be taken away.

**One old race had to be closed first.** A board opened by deep link was
materialised in memory and only written to disk by the first debounced save,
so for a few hundred milliseconds it existed on the remote — the sync round
runs the moment hydration finishes — and not on this disk. The reconcile pass
then read this device's own upload back as a board arriving from another one.
Harmless until an arrival came to mean something; it now writes the record
immediately, which is what the code always claimed to do.

**Reverses if:** empty boards ever carry meaning of their own — a template, a
board shared by name before it has content. Then the placeholder needs a flag
saying it was created _by the app_ rather than being inferred from its
emptiness.

## D80 — The home page is a document, not the app

Google rejected the OAuth consent screen three times over on the same URL. The
homepage `https://hikarintu.github.io/canwas/` "is not registered to you", it
"must be signed in to view", and it "does not explain what the app is for" —
and the last two are one fault, not two. That URL is the app. It boots a
router, redirects into a board, and shows a canvas with a sign-in button on it.
A reviewer arriving without an account sees furniture and no prose.

So the consent screen points at `about.html` instead, a fourth static page
beside privacy, support and licenses (D67). It ships no JavaScript, waits for
nothing, and reads the same whether or not anyone has ever signed in.

What it must contain is set by the review checklist rather than by taste: what
the application is for, **which** Google data it asks for and why, the exact
scope string, an explicit statement of what the scope does _not_ reach, how to
withdraw access, an identifiable publisher, and links onward to the policy and
the support channel. `e2e/pages.spec.ts` asserts each of those, including that
the scope named on the page is the one `auth.ts` actually requests — the same
guard the privacy policy already had, for the same reason: widening the scope
in code turns a paragraph on a public page into a false statement.

Ownership is a separate matter and not a code change: `github.io` is on the
Public Suffix List, so `hikarintu.github.io` verifies as its own site in Search
Console via HTML-file upload — which is a file in `public/`, from the same
Google account that owns the OAuth project. There is no DNS to prove.

**Reverses if:** the app ever gains a real landing screen — one that explains
itself before it opens a board. Then the document and the app agree and the
consent screen can point at the root again.

## D81 — The sitemap is generated, and the page list has one home

Five URLs is not enough work to justify a plugin dependency, and it is exactly
enough to go stale by hand. So `vite.config.ts` emits `sitemap.xml` and
`robots.txt` from `DOCUMENTS`, the same object the multi-page build takes its
Rollup inputs from. Adding a document page is one edit; a page that is built
but unlisted — the failure nobody sees, because the page works fine — cannot
happen. `check-pwa.mjs` asserts the two lists still agree.

`lastmod` comes from `git log -1` on the file, not from the build clock. A
stamp that moves on every deploy claims all five pages changed whenever any of
them did, which is the sort of signal a crawler learns to disregard. No stamp
at all is valid, and is what a shallow checkout gets.

The app's board URLs are absent on purpose: they are hash routes (D6), so
`#/<board>` never reaches a server, and each one names a board that exists on
one person's device. `Disallow: /canwas/assets/` keeps crawlers out of the
hashed bundle, which is re-hashed every deploy and contains a 13 MB wasm — a
bot that follows it pays for it again under a filename that no longer exists.

Every page also carries `rel="canonical"`. GitHub Pages answers both
`/canwas/about` and `/canwas/about.html`, and the OAuth consent screen points
at the first while every link in the site points at the second; without a
canonical the two are duplicate documents that split whatever standing the
page has.

**None of this was for the verification.** Ownership is decided by the
verification token and the property's scope, and a sitemap changes neither.
This was worth doing on its own terms.

**Reverses if:** a page ever needs to be listed that is not a build input — a
redirect, or something served from `public/`. Then `DOCUMENTS` stops being the
input map and becomes a list the input map is derived from.

## D82 — The silent path names the account

`prompt: ""` was doing less than it appeared to. It suppresses the _consent_
screen, and it suppresses the account chooser only when there is nothing to
choose: one Google session, one possible answer, popup opens and closes. On a
browser signed into two accounts there is an ambiguity, so Google asks — every
reconnect, however many times the same person has already picked the same
account. Which is the machine most likely to have two accounts, and the least
likely to forgive being asked hourly.

`lastAccount()` already held the email, for a different purpose: telling a
signed-out browser whose Reconnect button to draw. It is also the answer to the
ambiguity, so it is now passed as `hint`.

**Per request, not at construction.** `initTokenClient` is called once and the
client cached for the life of the page, so a hint fixed there could never
change — signing out to switch accounts would go on naming the old one.

**Only on the silent path.** `prompt: "consent"` is what runs when someone is
deliberately connecting, and hinting there would steer them back toward the
account they may be trying to leave. Sign-out clears the remembered account, so
the next connection is unhinted by construction.

Worth noting what the hint is not: it opens nothing, proves nothing, and is
refused like any other request if the grant is gone. It is a suggestion about
whose session to use, checked against session cookies on Google's own origin.

**Reverses if:** the app ever supports two accounts at once. Then "the last
account" stops being a single answer and the hint has to come from whichever
account owns the board being synced.
