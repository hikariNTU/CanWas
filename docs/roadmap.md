# Roadmap

Ordered so the risky part (the OCR overlay) is reachable early, and so every step
before it is independently useful.

| #   | Step                                                                              | State   |
| --- | --------------------------------------------------------------------------------- | ------- |
| 0   | Documentation + design grilling                                                   | ✅ done |
| 1   | Skeleton: Vite 8, React 19, TS 7, Tailwind 4, oxlint/oxfmt, router, CI            | ✅ done |
| 2   | Viewport: pan, zoom, world↔screen transform                                       | ✅ done |
| 3   | Ingest: paste + drop → Asset + Node, fit to viewport                              | ✅ done |
| 4   | Board store + **history stack**: select, move, resize, delete, reorder, undo/redo | ✅ done |
| 5   | Persistence: IndexedDB assets + boards, startup sweep, board list in menu         | ✅ done |
| 6   | OCR seam: `Recognizer`, `MockRecognizer`, worker wiring, per-asset status         | ✅ done |
| 7   | Selection overlay: transparent spans, scaleX fit, single-node scope               | ✅ done |
| 8   | Playwright happy path + screenshots                                               | ⏳ next |
| —   | _ship / evaluate_                                                                 |         |
| 9   | Real PaddleOCR behind `Recognizer`                                                | ✅ done |

## Why history lands at step 4

Steps 1–2 contain no content mutations — a skeleton has nothing to undo and pan/
zoom is deliberately not undoable ([D17](decisions.md)). Step 3 introduces the
first mutation, step 4 introduces the rest. Landing the stack with step 4 means
every mutation is born with its inverse and none is retrofitted.

The store shape is already locked by the design grilling, so nothing built in
steps 1–3 can paint the history design into a corner.

## Step 1 scope

What "skeleton" means precisely, so it can be called done:

- `npm run check` passes (format:check, lint, typecheck, build)
- Routes `#/` and `#/board/$boardId` render distinct placeholder screens
- Tailwind 4 wired, dark palette applied, no theme extension
- `useTranslation()` working with both locales and a language toggle
- One Base UI component mounted, proving the integration
- `navigator.storage.persist()` requested at startup
- GitHub Actions builds and deploys to Pages on push to `master`
- Playwright installed with one smoke test that loads `#/`

Explicitly _not_ in step 1: any canvas behaviour, any image handling, any history
stack, any store beyond the language atom.

## Non-goals

Not planned, and each needs a written decision to enter scope: server or accounts,
real-time collaboration, freehand drawing, PDF import, node types beyond images.
Crop is the most likely future addition and is a cheap migration
([domain model](domain-model.md#deliberately-absent)).
