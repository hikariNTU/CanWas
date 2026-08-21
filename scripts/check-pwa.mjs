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

// Android masks every launcher icon and puts one that cannot be masked on a
// white plate, which nobody sees until they install it on a phone (D100). One
// manifest key away at all times, like everything else checked here.
const maskable = manifest.icons?.some((icon) =>
  icon.purpose?.split(" ").includes("maskable"),
);
if (!maskable) {
  problems.push("no maskable icon: Android will put the icon on a white plate");
}

const PAGES = [
  "index.html",
  "about.html",
  "privacy.html",
  "support.html",
  "licenses.html",
];

for (const page of PAGES) {
  if (!precached.includes(page)) {
    problems.push(`${page} is not precached and will not open offline`);
  }
}

// The sitemap is generated from the same list the build reads (D81), so this
// is not checking the generator against itself: it is checking that the list
// and this file still agree about what a page is. A page missing here is a
// page nobody outside can find.
const sitemap = read("sitemap.xml");
for (const page of PAGES) {
  const loc = `https://hikarintu.github.io/canwas/${page === "index.html" ? "" : page}`;
  if (!sitemap.includes(`<loc>${loc}</loc>`)) {
    problems.push(`${page} is built but missing from sitemap.xml`);
  }
}

// A sitemap nothing points at is a file nobody fetches.
const robots = read("robots.txt");
if (
  !robots.includes("Sitemap: https://hikarintu.github.io/canwas/sitemap.xml")
) {
  problems.push("robots.txt does not point at the sitemap");
}
if (!robots.includes("Disallow: /canwas/assets/")) {
  problems.push("robots.txt lets crawlers into the hashed bundle");
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
