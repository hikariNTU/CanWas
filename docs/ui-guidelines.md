# UI guidelines

## Principles

**Simple and modern.** The images are the content. Chrome recedes: no gradients,
no shadows competing with image edges, no decorative motion. If a control isn't
in use, it should be quiet or absent.

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

One accent. Introducing a second needs a reason written into
[decisions](decisions.md).

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
- Floating panels: `bg-neutral-900/90 backdrop-blur border border-neutral-800`.
- Radius `rounded-lg` on panels, `rounded-md` on controls. Consistent, not zero —
  this is not homepage's Modernist system.
- Hit targets at least 32px square.
- **Conditional controls go at the end of a row.** A control that appears with
  the selection must never move the permanent ones — undo and redo shifting
  sideways as you select a node makes them feel unreliable to aim at.
- **A surface means something.** Chrome that is only read carries no background;
  a background marks a thing as interactive or editable. The board title is bare
  text at rest and gains a field only while being edited.

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
