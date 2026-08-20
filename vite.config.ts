import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Build identity, resolved once at build time and inlined.
 *
 * Read from git and from the installed package rather than written down
 * anywhere, so the About panel cannot claim a version the build does not have.
 * `git describe` fails in a shallow checkout or a tarball, which is why the
 * fallback is a literal rather than a throw.
 */
function gitDescription(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function isDirty(): boolean {
  try {
    return (
      execSync("git status --porcelain", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() !== ""
    );
  } catch {
    return false;
  }
}

/**
 * Read from the lockfile's installed copy, not by importing the package —
 * `onnxruntime-web` does not export `./package.json`, and a version string is
 * not worth loading a runtime for.
 */
const ortVersion = (
  JSON.parse(
    readFileSync(
      new URL("./node_modules/onnxruntime-web/package.json", import.meta.url),
      "utf8",
    ),
  ) as { version: string }
).version;

/** Rollup wants a path, and `import.meta.url` is the only root this file knows. */
function htmlEntry(name: string): string {
  return new URL(`./${name}`, import.meta.url).pathname;
}

// https://vitejs.dev/config/
export default defineConfig({
  worker: {
    // ES, not the default IIFE. An IIFE worker bundle has nowhere to put a
    // dynamic import, so Rollup inlines it — which silently undid the split
    // that keeps ONNX Runtime out of the worker's first load.
    format: "es",
  },
  define: {
    __BUILD_COMMIT__: JSON.stringify(
      `${gitDescription()}${isDirty() ? "+" : ""}`,
    ),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __ORT_VERSION__: JSON.stringify(ortVersion),
  },
  base: "/canwas/",
  build: {
    rollupOptions: {
      // Multi-page, deliberately. The app is a hash router (D6) because Pages
      // 404s on deep-link refresh; a hash never reaches a server, so `#/privacy`
      // is not a URL anything but a browser can fetch — and a privacy policy
      // that Google's reviewer, a crawler or a link unfurler cannot fetch is
      // not a published policy. Real `.html` files have no deep-link problem,
      // so these sit beside the router without contradicting it (D67).
      input: {
        app: htmlEntry("index.html"),
        about: htmlEntry("about.html"),
        privacy: htmlEntry("privacy.html"),
        support: htmlEntry("support.html"),
        licenses: htmlEntry("licenses.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@/": new URL("./src/", import.meta.url).pathname,
    },
  },
  plugins: [
    tanstackRouter({
      routeFileIgnorePrefix: "-",
    }),
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt`, never `autoUpdate`. An automatic update reloads the page the
      // moment a new build is found, and a reload here throws away a warm OCR
      // session — 31 MB of weights and an initialised runtime — mid-read. The
      // app asks instead (D72).
      registerType: "prompt",
      // The four document pages are real HTML entries (D67), so they are
      // precached like any other asset and open offline. `icon.png` stays for
      // the favicon; the 192 and 512 sizes are what a home screen wants.
      includeAssets: ["icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "CanWas",
        short_name: "CanWas",
        description:
          "An infinite board for images and text. Paste a screenshot, arrange it, and read the text back out of it.",
        lang: "en",
        // Both relative to the deployed subpath, not to the domain root: the
        // site lives under /canwas/ and a scope of "/" would claim the whole
        // github.io origin, every other project page included.
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "any",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        // ONNX Runtime's wasm is 13.5 MB and is deliberately NOT precached.
        // Precaching bills every install for a runtime plenty of sessions
        // never reach, on the device least able to afford it — and it would be
        // the larger half of an install that is otherwise about 600 kB. It is
        // runtime-cached below instead, so it survives offline from the first
        // recognition onward, which is exactly when its 31 MB of weights
        // arrive too.
        globIgnores: ["**/*.wasm"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // A hash never reaches a server (D6), so the only navigation this app
        // ever makes is to one of the four real HTML files. Each is precached
        // under its own URL, and a fallback that rewrote them to the app would
        // serve the board where a privacy policy was asked for.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/\.html$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Same-origin wasm: cached the first time recognition needs it,
            // then held. `CacheFirst` because the URL is content-hashed, so a
            // new build asks for a different name and can never be stale.
            urlPattern: ({
              url,
              sameOrigin,
            }: {
              url: URL;
              sameOrigin: boolean;
            }) => sameOrigin && url.pathname.endsWith(".wasm"),
            handler: "CacheFirst",
            options: {
              cacheName: "onnx-runtime",
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The stylesheet: revalidated in the background so a font update is
            // picked up, but never blocking a load.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css" },
          },
          {
            // The font files themselves are immutable and hashed by URL.
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-files",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Recognition weights are deliberately absent. They are 31 MB, they
        // are fetched once from huggingface.co, and IndexedDB already owns the
        // copy that survives a reload (D40) — caching them a second time would
        // double the storage a phone is asked for, on the one device most
        // likely to evict it.
      },
    }),
  ],
});
