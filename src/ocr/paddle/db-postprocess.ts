/**
 * Turning the detector's probability map into boxes.
 *
 * DBNet emits one probability channel, so there are no anchors and no NMS to
 * run — the work is thresholding, grouping what survives, and expanding each
 * group back out to the text it came from. Thresholds are the model's own, from
 * `DBPostProcess` in its `inference.yml`.
 */

/** Probability above which a pixel is text. */
const BINARY_THRESHOLD = 0.3;
/** Mean probability a box must reach to be kept. */
const BOX_SCORE_THRESHOLD = 0.6;
/**
 * How far a box is grown after thresholding. The binarized map is tighter than
 * the glyphs that produced it, and without this the box clips ascenders and the
 * crop handed to the recognizer is missing the tops of its letters.
 */
const UNCLIP_RATIO = 1.5;
/** Smaller than this in either axis is speckle. */
const MIN_SIDE = 3;

export interface DetectedBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  score: number;
}

/**
 * Axis-aligned boxes only.
 *
 * PaddleOCR fits a minimum-area rectangle to each contour and can return
 * rotated quads. Nothing downstream here can use one: a `Word` is an
 * axis-aligned box in asset space, and the overlay renders unrotated spans, so
 * a rotated result would be squared off anyway. Screenshots — the case this app
 * is for — have no rotation to recover.
 */
export function boxesFromProbabilityMap(
  probabilities: Float32Array,
  width: number,
  height: number,
): DetectedBox[] {
  const labels = new Int32Array(width * height).fill(-1);
  const boxes: DetectedBox[] = [];
  const stack: number[] = [];

  for (let seed = 0; seed < labels.length; seed++) {
    if (labels[seed] !== -1 || probabilities[seed] <= BINARY_THRESHOLD) {
      continue;
    }
    // Flood fill from the seed, 8-connected so that the gap between a letter
    // and its neighbour's diagonal stroke does not split one word in two.
    const label = boxes.length;
    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;
    labels[seed] = label;
    stack.push(seed);
    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          const neighbour = ny * width + nx;
          if (
            labels[neighbour] === -1 &&
            probabilities[neighbour] > BINARY_THRESHOLD
          ) {
            labels[neighbour] = label;
            stack.push(neighbour);
          }
        }
      }
    }

    const boxWidth = right - left + 1;
    const boxHeight = bottom - top + 1;
    if (boxWidth < MIN_SIDE || boxHeight < MIN_SIDE) {
      continue;
    }

    // Mean probability over the box, which is PaddleOCR's `box_score_fast`.
    let total = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        total += probabilities[y * width + x];
      }
    }
    const score = total / (boxWidth * boxHeight);
    if (score < BOX_SCORE_THRESHOLD) {
      continue;
    }

    // The same expansion PaddleOCR applies, which for an axis-aligned box
    // reduces to offsetting every edge by area x ratio / perimeter.
    const distance =
      (boxWidth * boxHeight * UNCLIP_RATIO) / (2 * (boxWidth + boxHeight));
    boxes.push({
      x0: Math.max(0, left - distance),
      y0: Math.max(0, top - distance),
      x1: Math.min(width, right + 1 + distance),
      y1: Math.min(height, bottom + 1 + distance),
      score,
    });
  }

  return boxes;
}

/**
 * Reading order: down the page, then across.
 *
 * Boxes come out of the flood fill in raster order of their seed pixel, which
 * is close but not the same — a tall box seeded early can precede a short one
 * above it. The overlay emits spans in this order and native selection follows
 * DOM order, so getting it wrong scrambles every multi-line copy.
 */
export function inReadingOrder<
  T extends { x0: number; y0: number; y1: number },
>(boxes: readonly T[]): T[] {
  return [...boxes].sort((a, b) => {
    // Two boxes are on the same line when they overlap vertically by more than
    // half the shorter one; only then does horizontal position decide.
    const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    const shorter = Math.min(a.y1 - a.y0, b.y1 - b.y0);
    if (overlap > shorter / 2) {
      return a.x0 - b.x0;
    }
    return a.y0 - b.y0;
  });
}
