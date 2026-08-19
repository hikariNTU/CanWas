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

| Role | Class |
| --- | --- |
| Canvas void | `bg-neutral-950` |
| Panel / chrome surface | `bg-neutral-900` |
| Raised surface, hover | `bg-neutral-800` |
| Hairline border | `border-neutral-800` |
| Primary text | `text-neutral-100` |
| Secondary text | `text-neutral-400` |
| Disabled / hint | `text-neutral-600` |
| Selection / focus accent | `ring-sky-500`, `bg-sky-500/20` |
| Destructive | `text-red-400` |

One accent. Introducing a second needs a reason written into
[decisions](decisions.md).

## Layout

- Canvas is full-bleed. Chrome floats over it, never reserves layout space.
- Floating panels: `bg-neutral-900/90 backdrop-blur border border-neutral-800`.
- Radius `rounded-lg` on panels, `rounded-md` on controls. Consistent, not zero —
  this is not homepage's Modernist system.
- Hit targets at least 32px square.

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
