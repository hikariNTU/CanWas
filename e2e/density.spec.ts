import { expect, test } from "@playwright/test";

import { densityFromDpi, readPngDensity } from "../src/board/density";

/**
 * Runs in Node: this is a byte parser, and a page adds nothing to it.
 *
 * Worth its own file because the failure mode is quiet. A density read wrongly
 * does not throw — it puts every pasted screenshot on the board at half or
 * double the size it should be, which looks like a design decision.
 */

/** Bytes a real PNG would start with. CRCs are not checked, so they are zero. */
function png(chunks: { type: string; data: number[] }[]): ArrayBuffer {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const chunk of chunks) {
    const { length } = chunk.data;
    bytes.push(
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
    );
    for (const character of chunk.type) {
      bytes.push(character.charCodeAt(0));
    }
    bytes.push(...chunk.data, 0, 0, 0, 0);
  }
  return new Uint8Array(bytes).buffer;
}

function physical(
  perMetre: number,
  unit = 1,
): { type: string; data: number[] } {
  const axis = [
    (perMetre >>> 24) & 0xff,
    (perMetre >>> 16) & 0xff,
    (perMetre >>> 8) & 0xff,
    perMetre & 0xff,
  ];
  return { type: "pHYs", data: [...axis, ...axis, unit] };
}

const IHDR = { type: "IHDR", data: Array.from({ length: 13 }, () => 0) };

test("screen densities are recognised and nothing else is", () => {
  // What macOS `screencapture` writes: 72 DPI at 1x, 144 at 2x.
  expect(densityFromDpi(72)).toBe(1);
  expect(densityFromDpi(144)).toBe(2);
  expect(densityFromDpi(216)).toBe(3);
  // Windows counts from 96.
  expect(densityFromDpi(96)).toBe(1);
  expect(densityFromDpi(192)).toBe(2);
  // A 300 DPI scan is a big image, not a small one recorded densely. Dividing
  // it by four would be the worst possible reading.
  expect(densityFromDpi(300)).toBe(1);
  expect(densityFromDpi(0)).toBe(1);
  // Never enlarges: a file claiming to be below screen density is taken as 1.
  expect(densityFromDpi(36)).toBe(1);
});

test("a retina screenshot's own header says it is 2x", () => {
  // 5669 px/m is 144 DPI, which is what a 2x capture carries.
  expect(readPngDensity(png([IHDR, physical(5669)]))).toBe(2);
  expect(readPngDensity(png([IHDR, physical(2835)]))).toBe(1);
});

test("an image with no opinion is taken at face value", () => {
  expect(readPngDensity(png([IHDR, { type: "IDAT", data: [0] }]))).toBe(1);
  // Unit 0 means the numbers are an aspect ratio, not a size — it says nothing
  // about how big the image should be.
  expect(readPngDensity(png([IHDR, physical(5669, 0)]))).toBe(1);
  // Not a PNG at all.
  expect(readPngDensity(new Uint8Array([1, 2, 3, 4]).buffer)).toBe(1);
  expect(readPngDensity(new ArrayBuffer(0))).toBe(1);
});

test("the walk stops at the pixels", () => {
  // A `pHYs` after IDAT is not metadata a screenshot tool wrote, and reading
  // one would mean walking a whole image looking for it.
  expect(
    readPngDensity(png([IHDR, { type: "IDAT", data: [0] }, physical(5669)])),
  ).toBe(1);
});
