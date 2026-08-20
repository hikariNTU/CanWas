# CanWas

**→ [hikarintu.github.io/canwas](https://hikarintu.github.io/canwas/)**

A spatial image board for the browser. Paste or drop screenshots onto an infinite
canvas, arrange them freely, and select text out of them.

Think PureRef's spatial freedom, with the text in your screenshots actually
selectable.

Everything runs on your device: boards live in IndexedDB, recognition runs in a
worker, and there is no server. Connecting Google Drive syncs your boards
between your own devices and nowhere else.

**Status:** all nine build steps are done. The canvas, history, persistence,
real PaddleOCR recognition and Drive sync are all in. What is designed and not
built is listed in the [roadmap](docs/roadmap.md).

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
| `npm run licenses`                | Regenerate `licenses.html` (only when deps change)   |
| `npm run test:e2e`                | Playwright happy-path suite (local only, not in CI)  |
| `npm run check`                   | format:check + lint + typecheck + build, in sequence |

## Documentation

Read in this order:

1. [Domain model](docs/domain-model.md) — the vocabulary. Start here.
2. [Architecture](docs/architecture.md) — layers, data flow, coordinate spaces.
3. [Decisions](docs/decisions.md) — what was chosen and why.
4. [UI guidelines](docs/ui-guidelines.md) — visual language and i18n rules.
5. [Roadmap](docs/roadmap.md) — build order and current position.
6. [Sync](docs/sync.md) and its [limits](docs/sync-limits.md) — the merge, and what it will not do.
7. [OCR research](docs/ocr-research.md) — measured engine/weight survey.

## The document pages

`privacy.html`, `support.html` and `licenses.html` are real static pages built
beside the app, not routes ([D67](docs/decisions.md)). The app uses hash history,
and a hash never reaches a server — so `#/privacy` cannot be fetched by Google's
OAuth reviewer, a crawler, or a link unfurler. These ship no JavaScript, which
also means they still render when the app itself fails to start.

`npm run licenses` regenerates the component list in `licenses.html` from the
modules the production build actually bundles — including the ones only the OCR
worker imports — plus the fonts and model weights fetched at runtime. Run it
when dependencies change and commit the result.

## Text recognition

The app uses PP-OCRv6 small and fetches 31 MB of weights the first time an image
needs reading, caching them in IndexedDB. Images are never uploaded: recognition
happens on the device. `?engine=mock` swaps in the fake recognizer, which invents
its strings but finds real ink — useful for looking at the overlay without the
download.

The end-to-end suite runs on the mock. To exercise the real one:

```
E2E_REAL_OCR=1 npx playwright test e2e/paddle.spec.ts
```

`scripts/extract-charset.mjs` regenerates `src/ocr/paddle/charset.ts` from the
recognition model's own config. It only needs running if the model changes.

## Google Drive

Sign-in and sync are built. The only scope requested is `drive.file`, which
reaches files this app created and nothing else; the access token is held in
memory and never written to disk. Boards, images (as WebP) and recognized text
are stored in the user's own Drive. The merge design is in
[docs/sync.md](docs/sync.md).

To enable sign-in, copy `.env.example` to `.env` and set
`VITE_GOOGLE_CLIENT_ID`. Without it the app runs exactly as before and the panel
reports that the build has no client id.

Sharing a board with another person is deliberately not a feature.
