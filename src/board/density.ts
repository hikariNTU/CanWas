/**
 * How many image pixels the file intends per CSS pixel.
 *
 * A screenshot taken on a retina display is twice the size it appeared on
 * screen, and pasting it at its pixel count puts a picture on the board at
 * double the size of the thing it is a picture of. The correction has to come
 * from the file rather than from `devicePixelRatio`, for two reasons: the
 * machine pasting is not always the machine that captured, and a genuinely
 * large photo is not a 2x anything — dividing every image by the current
 * display's ratio would shrink it for no reason.
 *
 * PNG records this in a `pHYs` chunk, which is what `screencapture` on macOS
 * writes. Nothing else is parsed: a screenshot is a PNG, and an image with no
 * opinion is taken at face value.
 */

/** PNG's first eight bytes, which nothing else has. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Enough to reach `pHYs`, which the spec places before the pixel data.
 *
 * Only a colour profile or an EXIF block can push it past this, and both mean
 * an image that was processed by something other than a screenshot tool — for
 * which the answer is 1 anyway.
 */
const HEADER_BYTES = 64 * 1024;

const METRES_PER_INCH = 0.0254;

/**
 * Both baselines that appear in the wild: macOS writes multiples of 72, and
 * Windows multiples of 96. Which one a file used is recoverable, because only
 * one of them divides it into something close to a whole number.
 */
const BASELINES = [72, 96];

/** How far from a whole number a ratio may sit and still count as that ratio. */
const TOLERANCE = 0.02;

/**
 * A whole-number density, or 1.
 *
 * Deliberately conservative. A 300 DPI scan divides into neither baseline and
 * is left alone at full size, which is right — it is a big image, not a small
 * image recorded densely. Only the exact multiples that a screen actually
 * produces are treated as scaling.
 */
export function densityFromDpi(dpi: number): number {
  for (const baseline of BASELINES) {
    const ratio = dpi / baseline;
    const rounded = Math.round(ratio);
    if (rounded >= 2 && Math.abs(ratio - rounded) < TOLERANCE) {
      return rounded;
    }
  }
  return 1;
}

/** The `pHYs` density of a PNG, or 1 for anything else. */
export function readPngDensity(bytes: ArrayBuffer): number {
  const view = new DataView(bytes);
  if (view.byteLength < SIGNATURE.length) {
    return 1;
  }
  for (const [index, byte] of SIGNATURE.entries()) {
    if (view.getUint8(index) !== byte) {
      return 1;
    }
  }

  let offset = SIGNATURE.length;
  // Every chunk is length, type, data, CRC. Walking them is the only way to
  // find one: PNG has no index.
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );
    const data = offset + 8;

    if (type === "IDAT" || type === "IEND") {
      // Past the metadata. Anything after this is pixels.
      return 1;
    }
    if (type === "pHYs" && length === 9 && data + 9 <= view.byteLength) {
      // Unit 1 is metres. Unit 0 means "these numbers are a ratio, not a
      // size", which says nothing about how big the image should be.
      if (view.getUint8(data + 8) !== 1) {
        return 1;
      }
      const perMetre = view.getUint32(data);
      return densityFromDpi(perMetre * METRES_PER_INCH);
    }

    offset = data + length + 4;
  }
  return 1;
}

/** Reads only the head of the blob: the whole file may be tens of megabytes. */
export async function readDensity(blob: Blob): Promise<number> {
  try {
    return readPngDensity(await blob.slice(0, HEADER_BYTES).arrayBuffer());
  } catch {
    // A density is a nicety. Failing to read one must never fail a paste.
    return 1;
  }
}
