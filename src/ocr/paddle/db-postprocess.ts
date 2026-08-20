/**
 * Turning the detector's probability map into boxes.
 *
 * DBNet emits one probability channel, so there are no anchors and no NMS to
 * run — the work is thresholding, grouping what survives, and expanding each
 * group back out to the text it came from. Thresholds are the model's own, from
 * `DBPostProcess` in its `inference.yml`.
 */

/** Probability above which a pixel is text. */
const BINARY_THRESHOLD = 0.2;
/** Mean probability a box must reach to be kept. */
const BOX_SCORE_THRESHOLD = 0.45;
/**
 * How far the thresholded region is grown before it is cropped and read.
 * PaddleOCR's own value: deliberately generous, because a crop that clips
 * ascenders costs accuracy and a crop with slack costs nothing.
 */
const CROP_UNCLIP_RATIO = 1.4;
/**
 * How far it is grown to get back the box the glyphs actually occupy.
 *
 * DBNet is trained against regions shrunk by Vatti clipping with a ratio of
 * 0.4, offset inward by `area x (1 - 0.4^2) / perimeter`. Expanding by the same
 * quantity is the inverse of that, so this constant is the training recipe read
 * backwards rather than a number tuned until the highlight looked right.
 *
 * Measured against ink at y 45.3..77.2 on a 34px line: the raw region was
 * y 51..69, the crop expansion gave y 37..83, and this one gives y 44..76.
 */
const TEXT_UNCLIP_RATIO = 1 - 0.4 * 0.4;
/** Smaller than this in either axis is speckle. */
const MIN_SIDE = 3;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DetectedBox extends Box {
  score: number;
  /**
   * Where the glyphs are, as opposed to where they are cropped from.
   *
   * DBNet predicts a *shrunk* version of each text region, so the raw region is
   * smaller than the glyphs and both of these boxes are expansions of it — but
   * for different jobs. The outer one is cropped and read, and is deliberately
   * loose. This one is what a `Word` reports, because it is the box a highlight
   * has to sit on, and 8px of slack there is 8px of highlight hanging off the
   * text.
   */
  text: Box;
}

/** Offsets every edge outward by `area x ratio / perimeter`, as Vatti would. */
function expand(
  left: number,
  top: number,
  right: number,
  bottom: number,
  ratio: number,
  width: number,
  height: number,
): Box {
  const boxWidth = right - left;
  const boxHeight = bottom - top;
  const distance =
    (boxWidth * boxHeight * ratio) / (2 * (boxWidth + boxHeight));
  return {
    x0: Math.max(0, left - distance),
    y0: Math.max(0, top - distance),
    x1: Math.min(width, right + distance),
    y1: Math.min(height, bottom + distance),
  };
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

    boxes.push({
      ...expand(
        left,
        top,
        right + 1,
        bottom + 1,
        CROP_UNCLIP_RATIO,
        width,
        height,
      ),
      score,
      text: expand(
        left,
        top,
        right + 1,
        bottom + 1,
        TEXT_UNCLIP_RATIO,
        width,
        height,
      ),
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
