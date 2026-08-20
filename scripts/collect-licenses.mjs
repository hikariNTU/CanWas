/**
 * Regenerates the package list inside `licenses.html`.
 *
 * Run it when dependencies change:
 *
 *     npm run licenses
 *
 * The list is *derived from the build*, not from `package.json`. A dependency
 * list over-reports badly — `npm ls --omit=dev` on this project names 84
 * packages, most of which are Babel and browserslist data that never reach a
 * user. The obligation attaches to what is distributed, so the source of truth
 * is the set of modules Rollup actually pulled into the bundle. This runs a
 * real build with `write: false` and asks Rollup which modules it touched.
 *
 * The output is committed. Generating at build time would put a filesystem walk
 * of `node_modules` on the deploy path for a page that changes twice a year.
 * The npm script pipes the result through oxfmt, which owns the formatting of
 * every HTML file here — otherwise `format:check` fails on freshly generated
 * markup.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = join(root, "licenses.html");
const START = "<!-- GENERATED:START -->";
const END = "<!-- GENERATED:END -->";

/**
 * Things that ship but are not npm packages, so nothing can discover them.
 *
 * The weights are the entry people forget: fetching a model at runtime and
 * caching it is still redistribution, and PP-OCR is Apache-2.0. The fonts come
 * from Google's CDN rather than the bundle, which is the same argument.
 */
const EXTRAS = [
  {
    name: "PP-OCRv6 (detection and recognition weights)",
    version: "small",
    license: "Apache-2.0",
    url: "https://github.com/PaddlePaddle/PaddleOCR",
    text: readFileSync(join(root, "licenses/apache-2.0.txt"), "utf8"),
  },
  {
    name: "Noto Sans, Noto Sans TC",
    version: "Google Fonts",
    license: "OFL-1.1",
    url: "https://fonts.google.com/noto",
    text: readFileSync(join(root, "licenses/ofl-1.1.txt"), "utf8"),
  },
  {
    name: "Material Symbols Rounded",
    version: "Google Fonts",
    license: "Apache-2.0",
    url: "https://github.com/google/material-design-icons",
    text: readFileSync(join(root, "licenses/apache-2.0.txt"), "utf8"),
  },
];

const LICENSE_FILES = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/** The package directory an absolute module path belongs to, or null. */
function packageRoot(id) {
  const marker = id.lastIndexOf("node_modules/");
  if (marker === -1) {
    return null;
  }
  const after = id.slice(marker + "node_modules/".length).split("/");
  // Scoped packages are two segments, everything else is one.
  const depth = after[0]?.startsWith("@") ? 2 : 1;
  if (after.length < depth) {
    return null;
  }
  return (
    id.slice(0, marker + "node_modules/".length) +
    after.slice(0, depth).join("/")
  );
}

function licenseText(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  // NOTICE last: Apache-2.0 wants both, and the licence is the larger claim.
  const found = names
    .filter((n) => LICENSE_FILES.test(n))
    .sort((a, b) => Number(/notice/i.test(a)) - Number(/notice/i.test(b)));
  if (found.length === 0) {
    return null;
  }
  return found
    .map((n) => readFileSync(join(dir, n), "utf8").trim())
    .join("\n\n---\n\n");
}

function homepage(manifest) {
  if (typeof manifest.homepage === "string") {
    return manifest.homepage;
  }
  const repository = manifest.repository;
  const url = typeof repository === "string" ? repository : repository?.url;
  if (typeof url !== "string") {
    return null;
  }
  const cleaned = url
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git:\/\//, "https://");
  // Some manifests put a GitHub shorthand here ("lukeed/clsx"), which is not a
  // URL and must not become an href.
  return cleaned.startsWith("http") ? cleaned : null;
}

function escape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const ids = new Set();

const collector = {
  name: "canwas-collect-licenses",
  generateBundle() {
    for (const id of this.getModuleIds()) {
      const dir = packageRoot(id);
      if (dir) {
        ids.add(dir);
      }
    }
  },
};

await build({
  root,
  logLevel: "warn",
  // Workers are a separate Rollup build with their own plugin container, so the
  // collector has to be installed twice. Without this, onnxruntime-web — the
  // single largest thing this app ships — is absent from the list, because it
  // is only ever imported inside the OCR worker.
  worker: { plugins: () => [collector] },
  // Nothing is written: this is a query about the module graph, and clobbering
  // `dist` with a build nobody asked to deploy would be a rude side effect.
  build: { write: false },
  plugins: [collector],
});

const packages = [];
for (const dir of ids) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    continue;
  }
  packages.push({
    name: manifest.name ?? dir,
    version: manifest.version ?? "",
    license:
      typeof manifest.license === "string"
        ? manifest.license
        : (manifest.license?.type ??
          manifest.licenses?.[0]?.type ??
          "see text"),
    url: homepage(manifest),
    text: licenseText(dir),
  });
}
packages.sort((a, b) => a.name.localeCompare(b.name));

const entries = [...packages, ...EXTRAS];

const rows = entries
  .map((entry) => {
    const name = entry.url
      ? `<a href="${escape(entry.url)}">${escape(entry.name)}</a>`
      : escape(entry.name);
    const body = entry.text
      ? `<details><summary>${escape(entry.license)} — full text</summary><pre>${escape(entry.text)}</pre></details>`
      : `<span class="stamp">${escape(entry.license)} — no licence file is shipped in this package</span>`;
    return `        <tr>
          <th>${name}<br /><span class="stamp">${escape(entry.version)}</span></th>
          <td>${body}</td>
        </tr>`;
  })
  .join("\n");

const generated = `${START}
      <p class="stamp">
        ${entries.length} components. Generated by
        <code>npm run licenses</code> from the modules this build actually
        bundles, plus the fonts and model weights it loads at runtime.
      </p>
      <table>
${rows}
      </table>
      ${END}`;

const html = readFileSync(target, "utf8");
const before = html.indexOf(START);
const after = html.indexOf(END);
if (before === -1 || after === -1) {
  throw new Error(`Markers ${START} / ${END} not found in ${target}`);
}
writeFileSync(
  target,
  html.slice(0, before) + generated + html.slice(after + END.length),
);

console.log(`licenses.html: ${entries.length} components written`);
