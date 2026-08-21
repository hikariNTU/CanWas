import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { defineConfig, type Plugin } from "vite";
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
 * The version the commit hook wrote, read rather than derived.
 *
 * Counting conventional commits at build time would need the whole history,
 * which a shallow CI checkout does not have. `package.json` always does (D89).
 */
const appVersion = (
  JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

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

/**
 * Every real URL this site has, in one place.
 *
 * Both the multi-page build and the sitemap read it, so a new document page is
 * one edit rather than two — and a page that exists but is unlisted, which is
 * the failure nobody notices, cannot happen (D81).
 */
const DOCUMENTS = {
  app: "index.html",
  about: "about.html",
  privacy: "privacy.html",
  support: "support.html",
  licenses: "licenses.html",
} as const;

/** Where the built site actually answers. Absolute URLs are required in a sitemap. */
const ORIGIN = "https://hikarintu.github.io";

/**
 * When a page last actually changed, from git rather than from the clock.
 *
 * `lastmod` stamped with the build time would claim every page changed on
 * every deploy, which is exactly the signal a crawler learns to ignore. An
 * untracked or unbuildable checkout gets no stamp at all, which is valid: the
 * element is optional.
 */
function lastModified(file: string): string | null {
  try {
    const stamp = execSync(`git log -1 --format=%cI -- ${file}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return stamp === "" ? null : stamp.slice(0, 10);
  } catch {
    return null;
  }
}

/**
 * `sitemap.xml` and `robots.txt`, emitted from the page list above.
 *
 * Written here rather than kept in `public/` because the two facts they need —
 * which pages exist, and what the base path is — already live in this file,
 * and a hand-maintained copy of either goes stale silently. Not a dependency:
 * five URLs do not justify a plugin.
 *
 * The app's own board URLs are deliberately absent. They are hash routes (D6),
 * so `#/<board>` never reaches a server and names a board that exists on one
 * person's device; there is nothing there for a crawler to fetch.
 */
function siteIndex(base: string): Plugin {
  return {
    name: "canwas-site-index",
    apply: "build" as const,
    generateBundle() {
      const url = (file: string) =>
        `${ORIGIN}${base}${file === "index.html" ? "" : file}`;

      const entries = Object.values(DOCUMENTS)
        .map((file) => {
          const stamp = lastModified(file);
          return [
            "  <url>",
            `    <loc>${url(file)}</loc>`,
            ...(stamp === null ? [] : [`    <lastmod>${stamp}</lastmod>`]),
            "  </url>",
          ].join("\n");
        })
        .join("\n");

      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          `${entries}\n</urlset>\n`,
      });

      // `Disallow: assets/` keeps crawlers off the hashed bundle, which
      // includes a 13 MB wasm binary and is re-hashed on every deploy — a bot
      // that follows it downloads it again for a filename that no longer
      // exists. Nothing there is a page.
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: [
          "User-agent: *",
          `Disallow: ${base}assets/`,
          "",
          `Sitemap: ${ORIGIN}${base}sitemap.xml`,
          "",
        ].join("\n"),
      });
    },
  };
}

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
    __BUILD_VERSION__: JSON.stringify(appVersion),
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
      input: Object.fromEntries(
        Object.entries(DOCUMENTS).map(([name, file]) => [
          name,
          htmlEntry(file),
        ]),
      ),
    },
  },
  resolve: {
    alias: {
      "@/": new URL("./src/", import.meta.url).pathname,
    },
  },
  plugins: [
    siteIndex("/canwas/"),
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
      includeAssets: [
        "icon.png",
        "icon-192.png",
        "icon-512.png",
        "icon-maskable-192.png",
        "icon-maskable-512.png",
      ],
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
        // Two sets, not one icon claiming both purposes. `any` is the icon as
        // drawn — a rounded square, which is what iOS and a desktop shortcut
        // want. `maskable` is full bleed with the letter inside the safe zone,
        // because Android masks every launcher icon into a shape of its
        // choosing and gives an icon that is not built for it a white plate to
        // sit on (D100). One file with `purpose: "any maskable"` would be
        // wrong in both places at once: padded where it should be tight, and
        // cropped where it should not be.
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
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
