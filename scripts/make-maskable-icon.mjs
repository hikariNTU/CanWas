/**
 * Builds the maskable icons from `icon-512.png`.
 *
 * Android masks every launcher icon into a shape it chooses — circle, squircle,
 * teardrop — and an icon that is not built for it gets a white plate behind it
 * instead. Ours is a rounded square with transparent corners, so it arrived on
 * the home screen as a small logo inside a white circle (D99).
 *
 * A maskable icon is full bleed with its subject inside the safe zone: a
 * centred circle of 40% radius, which is the most any mask can take away. So
 * the background gradient is extended to every pixel and the letter is drawn at
 * 80%, leaving a tenth of the width at each edge for the mask to eat.
 *
 * The letter is lifted out of the existing icon rather than redrawn: it is pure
 * white on a coloured field, so whiteness is the mask. That keeps this a
 * derivation of the real icon — rerun it after the icon changes and the two
 * cannot drift apart, which a hand-built second file would.
 *
 * Chromium does the compositing because it is already a dependency for the
 * tests, and the alternative was an image library for one script.
 *
 *   node scripts/make-maskable-icon.mjs
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../public/", import.meta.url);
const source = `data:image/png;base64,${readFileSync(new URL("icon-512.png", root)).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const icons = await page.evaluate(async (dataUrl) => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();

  const size = 512;
  const read = document.createElement("canvas");
  read.width = size;
  read.height = size;
  const source = read.getContext("2d");
  source.drawImage(image, 0, 0, size, size);
  const pixels = source.getImageData(0, 0, size, size);

  // Two points well inside the rounded rectangle, on the gradient's own
  // diagonal, so the extended background starts and ends where the original
  // does rather than at a colour picked by eye.
  const at = (x, y) => {
    const index = (y * size + x) * 4;
    const [r, g, b] = pixels.data.slice(index, index + 3);
    return `rgb(${r}, ${g}, ${b})`;
  };
  const start = at(24, 24);
  const end = at(size - 24, size - 24);

  // The letter as an alpha mask. It is white; the field is not; the ramp
  // between them is what keeps the edges smooth instead of stepped.
  const letter = document.createElement("canvas");
  letter.width = size;
  letter.height = size;
  const mask = letter.getContext("2d").createImageData(size, size);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const min = Math.min(
      pixels.data[i],
      pixels.data[i + 1],
      pixels.data[i + 2],
    );
    const whiteness = Math.max(0, Math.min(1, (min - 140) / (255 - 140)));
    mask.data[i] = 255;
    mask.data[i + 1] = 255;
    mask.data[i + 2] = 255;
    mask.data[i + 3] = Math.round(whiteness * pixels.data[i + 3]);
  }
  letter.getContext("2d").putImageData(mask, 0, 0);

  function render(target) {
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, target, target);
    gradient.addColorStop(0, start);
    gradient.addColorStop(1, end);
    context.fillStyle = gradient;
    context.fillRect(0, 0, target, target);
    // 80%, centred: the safe zone is a circle of 40% radius, and this is the
    // largest square that fits inside it in every direction.
    const inset = target * 0.1;
    context.drawImage(letter, inset, inset, target * 0.8, target * 0.8);
    return canvas.toDataURL("image/png");
  }

  return { 512: render(512), 192: render(192) };
}, source);

for (const [size, dataUrl] of Object.entries(icons)) {
  const file = new URL(`icon-maskable-${size}.png`, root);
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`wrote ${file.pathname.split("/").pop()}`);
}

await browser.close();
