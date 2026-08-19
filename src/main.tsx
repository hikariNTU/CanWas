import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import {
  createHashHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { routeTree } from "@/routeTree.gen";

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

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
