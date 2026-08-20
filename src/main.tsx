import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import {
  createHashHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { routeTree } from "@/routeTree.gen";
import { KNOWN_MODEL_IDS } from "@/ocr/paddle/models";
import {
  sweepOrphanedAssets,
  sweepUnknownModels,
  trimDeletedBoards,
} from "@/storage/db";

import "@/index.css";

// Hash history: GitHub Pages serves this under a subpath and 404s on deep-link
// refresh for non-hash routes without a 404.html shim (docs/decisions.md D6).
const router = createRouter({
  routeTree,
  history: createHashHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// IndexedDB is evictable under disk pressure and eviction is silent, so ask to
// be exempt before the user has anything to lose (docs/decisions.md D20).
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    return;
  }
  try {
    await navigator.storage.persist();
  } catch {
    // Denial is normal and not actionable; boards still work, they are just
    // evictable. Nothing to show the user.
  }
}
void requestPersistentStorage();

// Mark-and-sweep runs here and nowhere else (D14). Undo history is in-memory
// and therefore empty at startup, so the sweep cannot reclaim bytes an undo
// entry still needs.
void sweepOrphanedAssets().catch(() => {
  // A failed sweep only means orphaned bytes linger until the next start.
});

// The same argument for the weights, which have no owner to be reachable from
// at all: a retired model id is dead the moment the build stops naming it.
void sweepUnknownModels(KNOWN_MODEL_IDS).catch(() => {
  // Costs disk, not correctness.
});

/**
 * How long a deleted board keeps its contents (D66).
 *
 * The marker outlives this and everything else — it is what stops the board
 * being downloaded again — but the nodes are only kept so that a revive brings
 * the work back, and a revive that has not happened in a month is not going to.
 * Emptying the board is also what releases its images to the asset sweep.
 */
const GRAVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Ordered after the asset sweep on purpose: trimming now frees images for the
// *next* start rather than this one, which is a day's delay in reclaiming
// bytes and avoids a sweep racing a trim over the same records.
void trimDeletedBoards(GRAVE_RETENTION_MS).catch(() => {
  // Costs disk, not correctness.
});

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
