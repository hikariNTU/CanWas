# CanWas

A spatial image board for the browser. Paste or drop screenshots onto an infinite
canvas, arrange them freely, and select text out of them.

Think PureRef's spatial freedom, with the text in your screenshots actually
selectable.

**Status:** steps 1-5 of 9 complete — boards persist to IndexedDB, pan/zoom
canvas, paste and drop images, select/move/resize/delete/reorder with full
undo/redo. OCR is designed but not built.

## Quickstart

```bash
npm install
npm run dev
```

## Commands

| Command                           | What it does                                         |
| --------------------------------- | ---------------------------------------------------- |
| `npm run dev`                     | Vite dev server                                      |
| `npm run build`                   | Production build to `dist/`                          |
| `npm run typecheck`               | `tsc --noEmit`                                       |
| `npm run lint`                    | oxlint, zero warnings allowed                        |
| `npm run format` / `format:check` | oxfmt, includes Tailwind class sorting               |
| `npm run test:e2e`                | Playwright happy-path suite (local only, not in CI)  |
| `npm run check`                   | format:check + lint + typecheck + build, in sequence |

## Documentation

Read in this order:

1. [Domain model](docs/domain-model.md) — the vocabulary. Start here.
2. [Architecture](docs/architecture.md) — layers, data flow, coordinate spaces.
3. [Decisions](docs/decisions.md) — what was chosen and why.
4. [UI guidelines](docs/ui-guidelines.md) — visual language and i18n rules.
5. [Roadmap](docs/roadmap.md) — build order and current position.
6. [OCR research](docs/ocr-research.md) — measured engine/weight survey, for when OCR lands.
