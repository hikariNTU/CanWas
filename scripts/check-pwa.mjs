/**
 * Asserts the shape of the generated service worker.
 *
 * The precache manifest is written by Workbox from whatever the build happened
 * to emit, so nothing in the type system or the linter has an opinion about
 * it. The failures worth catching are silent ones: a document page that stops
 * being precached still works online and only breaks on a plane, and a 13.5 MB
 * wasm that starts being precached costs every install a download nobody
 * asked for. Both are one config key away at all times (D72).
 *
 * Runs against `dist` after a build, from `npm run check`.
 */
import { readFileSync } from "node:fs";

const root = new URL("../dist/", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

const problems = [];
const sw = read("sw.js");
const manifest = JSON.parse(read("manifest.webmanifest"));

// Workbox minifies to `{url:"x",revision:"y"}`, so the key order is not stable
// enough to match on. The URL is.
const precached = [...sw.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);

for (const page of [
  "index.html",
  "privacy.html",
  "support.html",
  "licenses.html",
]) {
  if (!precached.includes(page)) {
    problems.push(`${page} is not precached and will not open offline`);
  }
}

const wasm = precached.filter((url) => url.endsWith(".wasm"));
if (wasm.length > 0) {
  problems.push(
    `precache contains wasm (${wasm.join(", ")}) — every install now pays for it`,
  );
}

if (!/onnx-runtime/.test(sw)) {
  problems.push(
    "no runtime cache for the ONNX wasm — recognition is online-only",
  );
}

if (/huggingface/.test(sw)) {
  problems.push(
    "weights are cached by the worker; IndexedDB already holds them",
  );
}

// A scope of "/" would claim every other project on the github.io origin.
for (const key of ["scope", "start_url"]) {
  if (manifest[key] !== ".") {
    problems.push(
      `manifest ${key} is "${manifest[key]}", not "." — it must stay relative to /canwas/`,
    );
  }
}

for (const size of ["192x192", "512x512"]) {
  if (!manifest.icons.some((icon) => icon.sizes === size)) {
    problems.push(
      `manifest has no ${size} icon, so the app is not installable`,
    );
  }
}

if (problems.length > 0) {
  console.error("PWA check failed:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(`PWA ok — ${precached.length} precached entries`);
