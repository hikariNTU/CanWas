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
