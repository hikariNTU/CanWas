import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";

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
  ],
});
