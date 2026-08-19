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

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(
      `${gitDescription()}${isDirty() ? "+" : ""}`,
    ),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __ORT_VERSION__: JSON.stringify(ortVersion),
  },
  base: "/canwas/",
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
