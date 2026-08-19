# Roadmap

Ordered so the risky part (the OCR overlay) is reachable early, and so every
step before it is independently useful.

| # | Step | State |
| --- | --- | --- |
| 0 | Documentation | ✅ done |
| 1 | Skeleton: Vite 8, React 19, TS 7, Tailwind 4, oxlint/oxfmt, router, CI | ⏳ next |
| 2 | Viewport: pan, zoom, world↔screen transform | ☐ |
| 3 | Ingest: paste + drop → Asset + Node at cursor | ☐ |
| 4 | Board store: node select, move, delete, z-order | ☐ |
| 5 | Persistence: IndexedDB assets + boards, Home board list | ☐ |
| 6 | OCR seam: `Recognizer`, `MockRecognizer`, worker wiring, per-node status | ☐ |
| 7 | Selection overlay: transparent spans, scaleX fit, single-node scope | ☐ |
| 8 | Playwright happy path + screenshots | ☐ |
| — | *ship / evaluate* | |
| 9 | Real PaddleOCR behind `Recognizer` | ☐ future |

## Step 1 scope

What "skeleton" means precisely, so it can be called done:

- `npm run check` passes (format:check, lint, typecheck, build)
- Routes `#/` and `#/board/$boardId` render distinct placeholder screens
- Tailwind 4 wired, dark palette applied, no theme extension
- `useTranslation()` working with both locales and a language toggle
- One Base UI component mounted, proving the integration
- GitHub Actions builds and deploys to Pages on push to `master`
- Playwright installed with one smoke test that loads `#/`

Explicitly *not* in step 1: any canvas behaviour, any image handling, any store
beyond the language atom.

## Non-goals

Not planned, and each needs a written decision to enter scope: server or
accounts, real-time collaboration, freehand drawing, PDF import, node types
beyond images, undo/redo (likely earns its way in around step 4).
