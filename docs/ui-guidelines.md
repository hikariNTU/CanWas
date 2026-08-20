# UI guidelines

## Principles

**Simple and modern.** The images are the content. Chrome recedes: no gradients,
no decorative motion. If a control isn't in use, it should be quiet or absent.
Chrome is glass — translucent and blurred, so it reads as sitting above the
board rather than as a second board ([D58](decisions.md)).

**Dark only.** One theme ([D7](decisions.md#d7--dark-theme-only)). No light
tokens, no toggle.

**Stock Tailwind.** No registered custom colors, no extended theme
([D10](decisions.md#d10--no-tailwind-theme-extension)). Stock palette, stock
spacing scale.

## Palette

Stock Tailwind classes only. The working set, kept small on purpose:

| Role                     | Class                           |
| ------------------------ | ------------------------------- |
| Canvas void              | `bg-neutral-950`                |
| Panel / chrome surface   | `bg-neutral-900`                |
| Raised surface, hover    | `bg-neutral-800`                |
| Hairline border          | `border-neutral-800`            |
| Primary text             | `text-neutral-100`              |
| Secondary text           | `text-neutral-400`              |
| Disabled / hint          | `text-neutral-600`              |
| Selection / focus accent | `ring-sky-500`, `bg-sky-500/20` |
| Destructive              | `text-red-400`                  |

One accent, and it is spent on selection and focus only. A status must not use
it: sky on a working control makes it look like the thing the user just clicked
into. Statuses are neutral, except a failure, which is amber. Introducing a
third needs a reason written into [decisions](decisions.md).

## Glass

Floating chrome uses one of two classes from `index.css`, never its own
assembly of background, border and shadow:

| Class           | For                                                     |
| --------------- | ------------------------------------------------------- |
| `.glass`        | Controls and small chrome                               |
| `.glass-strong` | Panels, menus, dialogs — anything with paragraphs in it |

Both are the same treatment — translucent neutral-900, a 20px blur with the
saturation boost that makes a blurred backdrop read as glass rather than fog,
and a bright hairline along the top edge for a specular highlight. They differ
only in how much tint sits under the blur.

Radius stays in the markup, because it is the one part that genuinely differs:
`rounded-lg` on panels, `rounded-md` on controls.

Pick `.glass-strong` whenever the widget can end up over content rather than
over the canvas. The recognition badge is the case: at the thin tint, a
screenshot of a white page shows through and leaves a pale smudge.

## Icons

Material Symbols Rounded, via the `<Icon name="menu" />` wrapper. No icon
package is installed — the glyphs come from the Google Fonts variable font and
the wrapper is twenty lines.

Weight is 700, from the font's `wght` axis. That is a genuine weight axis, so
the strokes thicken rather than a thin glyph being scaled up.

Two rules the ligature mechanism imposes:

- `name` must be a real Material Symbols identifier in snake_case. A wrong name
  renders as the literal word, which is easy to miss in a dense toolbar.
- The element's text must survive untouched: no capitalisation, no
  letter-spacing, and `translate="no"` so page translation cannot rewrite it.

The font is loaded with `display=block`, not `swap`: an icon font renders its
ligature text until it loads, so `swap` would briefly show the chrome reading
"menu undo redo" in words.

Glyphs are `display: block` and rely on a flex or grid parent to centre them.
As inline boxes they align to the text baseline, which lifts them above the
label beside them.

No Unicode glyphs standing in for icons.

## Layout

- Canvas is full-bleed. Chrome floats over it, never reserves layout space.
- Floating panels: `.glass-strong`; controls: `.glass`. See above.
- Radius `rounded-lg` on panels, `rounded-md` on controls. Consistent, not zero —
  this is not homepage's Modernist system.
- Hit targets at least 32px square.
- **Conditional controls go at the end of a row.** A control that appears with
  the selection must never move the permanent ones — undo and redo shifting
  sideways as you select a node makes them feel unreliable to aim at.
- **A surface means something.** Chrome that is only read carries no background;
  a background marks a thing as interactive or editable. The board title is bare
  text at rest and gains a field only while being edited.

## Sync

Sync is a floating button of its own, beside the info button — not a line inside
the info panel. It is the only chrome that answers "is my work anywhere but
here", and a state you have to open a panel to read is a state nobody reads.

It is never hidden. The resting state says _not syncing_ rather than showing
nothing, because nothing is indistinguishable from working.

Synced is the one status worth colour: **emerald**, and the only green in the
app. It answers the question people ask without meaning to — is my work anywhere
but here — and green is read at the edge of vision where grey has to be looked
at. Syncing stays neutral, because a state that lasts two seconds does not need
announcing.

A failure — of a round, or of the connection itself — puts a red dot on the
button. Colour rather than a glyph, and on top of the icon rather than instead
of it: the icon still has to say which state sync is in, and a board is looked
at rather than inspected. It is the only red in the app, which is the point.
The two kinds of failure share the mark because a failed sign-in leaves no
transport, and "no transport" otherwise renders as a cheerful invitation to
connect.

The panel is headed by Google Drive's own mark and names the account that
granted access. A browser signed into two Google accounts will happily grant
one and leave you hunting for the files in the other.

The icon carries the state; the words live behind it. Opening it gives the
account, how full that Drive is, what the last round did or why it failed, and
sign in or sign out — everything the info panel used to say about Drive. The
split is by cost: the one-glance answer is free to look at, and the detail costs
a click, which is right because it is only wanted when something needs deciding.
_Sync now_ is in there too, for the round you want before closing a laptop.

## Recognition status

An icon at rest, a sentence when asked. A board of screenshots is a board of
these, and a caption on every image competes with the images for the one thing
the app is for — so the word appears on hover, and while the node is selected,
which is the touch answer to the same question.

The glyph carries the state. `document_scanner` waiting (there is no `ocr`
glyph — the name renders as the literal word), `progress_activity` spinning
while reading, `cloud_download` while the weights come down, `error` on a
failure. The spin is the one motion in the app that is not decoration: a long
download sits at the same percentage for seconds, and it is what says the tab
is working rather than wedged.

Idle and done say nothing. Idle would flash for a frame; done is announced by
the text becoming selectable, and a badge on every finished image is permanent
clutter.

The badge counter-scales, so it is the same size at any zoom — and it hides
entirely once the node is under 48px on screen, since a fixed-size badge on a
thumbnail is bigger than the thing it describes.

## Nodes

Nodes are `rounded-lg`, images included — the image carries the radius itself
rather than the node clipping it, because `overflow-hidden` on the node would
also cut off the resize handle, which sits outside the box on purpose.

That radius is in **world** units and scales with the zoom, unlike every other
measurement in the chrome. It belongs to the picture the way its size does, and
a corner that sharpened as you zoomed in would read as chrome painted on top.
The selection outline needs no radius of its own: an outline follows the
element's `border-radius`, so the two can never drift apart. It is held one
width off the content rather than drawn on its edge — a screenshot of a white
page swallows a white outline whole, and a blue one is no safer against a blue
screenshot, so the line always keeps the board behind it.

Reading a node — double-click, and the text inside becomes selectable — outlines
it in white rather than the accent. Inside that mode the accent belongs to the
text selection itself, so a node wearing it too reads as one more highlight;
white says instead that the node is in a different mode, which is the thing the
double-click just changed.

Text is bare on the board and gains a `.glass` field only while it is being
edited, the same as the board title. The resting and editing styles share a
class — including a transparent border matching the field's — so entering edit
mode cannot move a glyph or rewrap a line.

## Selecting

Click a node to select it, shift-click to add. Drag from empty canvas to draw a
selection box; everything it touches is selected, and shift extends the existing
selection instead of replacing it ([D54](decisions.md)). A selection of several
moves and deletes as one action, and one undo puts it all back.

A single selected node gets a resize handle at its bottom-right: an accent dot
with a light ring, which holds an edge against both a dark board and a pale
screenshot where the old solid square disappeared into one of them. The dot is
12px on screen and its grab area is 24px — a handle small enough to look right
is smaller than anyone can reliably hit, so the two are separated. Like the rest
of the selection chrome, both are counter-scaled and so are the same size at
every zoom.

Because the left button now selects, panning is two-finger scroll, middle-drag,
or space+drag — and one finger on touch, which has no other way.

## Reading an image

A recognized image is entered by double-clicking it, the same gesture that opens
a text node for editing ([D42](decisions.md)). Entered, it takes a text cursor,
stops dragging, and its words become selectable; the board's shortcuts stand
down so Delete and Select All belong to the selection. Escape leaves, as does a
press anywhere else.

Nothing marks a finished image as recognized. The badge is for work in progress
only — a permanent label on every image would be clutter on a full board, and
the text answering to a cursor is the affordance.

## Adding an image

Three ways in: paste, drop, and a file picker in the bottom right. The picker is
always visible, because the first two are desktop gestures and a phone has
neither.

## The info panel

Top right, opposite the menu. It states what this build is — commit, date,
recognizer, runtime version — and what the app has put on the user's disk:
images, cached weights, boards, and the browser's own figure for the origin.
Sync is not in here — it has its own button, above.

It exists because the app quietly downloads 21 MB and keeps it. The browser's
own estimate is shown alongside the counts rather than instead of them: it
covers overhead the app cannot see, so the two never quite agree and only the
counts explain anything. The cached weights can be cleared from here, since they
cost nothing but a re-download.

## Motion

Transitions on hover/focus state only, `duration-150`. Never animate pan, zoom,
or node position — they follow the pointer 1:1 and any easing reads as lag.
Respect `prefers-reduced-motion`.

## Focus and keyboard

Every control reachable by Tab with a visible `ring-2 ring-sky-500` focus ring.
Focus rings are never removed, only restyled.

The OCR overlay's spans must not become tab stops — hundreds of words would
destroy keyboard navigation. They are selectable, not focusable.

## Internationalization

Every user-visible string goes through `t()`. No exceptions, including
placeholders, `aria-label`s, `title`s, and empty-state copy.

```ts
const { t } = useTranslation();
<button aria-label={t("board.create")}>{t("board.create")}</button>
```

Rules:

- Keys are namespaced by area: `board.create`, `canvas.empty`, `ocr.running`.
- No string concatenation to build sentences — word order differs between
  zh-TW and en-US. Use a full templated string per message.
- Layout must survive a ~1.6x length change from zh-TW to en-US. No fixed-width
  text containers, no truncation without a `title`.
- Numbers and dates go through `Intl`, never hand-formatted.
