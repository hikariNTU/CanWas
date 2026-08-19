import type { Word } from "@/board/types";
import type { Recognizer, RecognizeOptions } from "@/ocr/types";

/**
 * A recognizer that finds where text *is* without reading it.
 *
 * It would be cheaper to emit boxes on a grid, but boxes that do not land on
 * ink prove nothing: the whole reason the mock ships first is to build and
 * judge the selection overlay, and an overlay is only judgeable when its
 * highlights sit on real glyphs. So this projects the image's ink onto both
 * axes to find plausible lines and words, then fills each box with invented
 * text sized to the box.
 *
 * What it is not: an engine. The strings are nonsense by construction.
 */

/** Long edge the analysis runs at. Full resolution buys nothing here. */
const SAMPLE_EDGE = 800;
/** Luminance distance from the background before a pixel counts as ink. */
const INK_THRESHOLD = 40;
/** Fraction of a row that must be inked before the row counts as text. */
const ROW_INK_FRACTION = 0.004;
/**
 * A gap at least this fraction of the line height wide is always a word break,
 * whatever the rest of the line looks like.
 */
const WIDE_GAP_RATIO = 0.45;
/** Bands shorter than this many sample pixels are speckle, not a line. */
const MIN_LINE_HEIGHT = 4;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Deterministic per-asset, so a re-run of the same image says the same thing. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const SYLLABLES = [
  "lor",
  "ip",
  "sum",
  "do",
  "lor",
  "sit",
  "amet",
  "con",
  "sec",
  "te",
  "tur",
  "ad",
  "ip",
  "isc",
  "ing",
  "el",
  "it",
  "sed",
  "do",
  "eius",
  "mod",
  "tem",
];

/** A word whose character count roughly matches the box it has to fill. */
function inventWord(box: Box, random: () => number): string {
  const height = box.y1 - box.y0;
  const width = box.x1 - box.x0;
  // 0.55em is a fair average advance width for lower-case Latin text.
  const target = Math.min(16, Math.max(1, Math.round(width / (height * 0.55))));
  let text = "";
  while (text.length < target) {
    text += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
  }
  return text.slice(0, target);
}

type Run = [start: number, end: number];

/** Maximal contiguous runs of `true` in a mask, as [start, end) pairs. */
function runsOf(mask: readonly boolean[]): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && start === -1) {
      start = i;
    } else if (!mask[i] && start !== -1) {
      runs.push([start, i]);
      start = -1;
    }
  }
  if (start !== -1) {
    runs.push([start, mask.length]);
  }
  return runs;
}

/**
 * The gap width that separates words on this line, or Infinity when the line
 * has no such split.
 *
 * A fixed fraction of the line height does not work: a space is about a quarter
 * of the font size while the line height is closer to the full size, so the one
 * ratio that separates words in a bold sans merges them in a condensed serif —
 * measured, a 34px bold line put its spaces at 9px and its letter gaps at 3px,
 * either side of a ratio guess. So the split is read off the line itself: sort
 * the gaps and cut at the widest jump between consecutive values. Letter gaps
 * cluster low, word gaps cluster high, and the jump between the clusters is the
 * largest one there.
 */
function wordGapThreshold(gaps: readonly number[]): number {
  if (gaps.length < 2) {
    return Infinity;
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  let bestJump = 0;
  let threshold = Infinity;
  for (let i = 0; i < sorted.length - 1; i++) {
    const jump = sorted[i + 1] - sorted[i];
    if (jump > bestJump) {
      bestJump = jump;
      threshold = (sorted[i] + sorted[i + 1]) / 2;
    }
  }
  // One cluster, evenly spaced: a line of a single word, or of letters spaced
  // so uniformly that any cut would be invented.
  return bestJump < 2 ? Infinity : threshold;
}

/** Merges glyph runs into word runs, cutting only at the wide gaps. */
function groupIntoWords(glyphs: readonly Run[], lineHeight: number): Run[] {
  if (glyphs.length === 0) {
    return [];
  }
  const gaps = glyphs.slice(1).map((run, index) => run[0] - glyphs[index][1]);
  const threshold = Math.min(
    wordGapThreshold(gaps),
    lineHeight * WIDE_GAP_RATIO,
  );

  const words: Run[] = [];
  let current: Run = [...glyphs[0]] as Run;
  for (let i = 1; i < glyphs.length; i++) {
    if (gaps[i - 1] >= threshold) {
      words.push(current);
      current = [...glyphs[i]] as Run;
    } else {
      current[1] = glyphs[i][1];
    }
  }
  words.push(current);
  return words;
}

/** The most common luminance, taken as the page background. */
function backgroundLuminance(luma: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (const value of luma) {
    histogram[value]++;
  }
  let best = 0;
  for (let i = 1; i < 256; i++) {
    if (histogram[i] > histogram[best]) {
      best = i;
    }
  }
  return best;
}

function sample(bitmap: ImageBitmap): {
  ink: boolean[];
  width: number;
  height: number;
  scale: number;
} {
  const scale = Math.min(
    1,
    SAMPLE_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("OffscreenCanvas 2d context unavailable");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);

  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i++) {
    const offset = i * 4;
    luma[i] =
      (data[offset] * 77 + data[offset + 1] * 150 + data[offset + 2] * 29) >> 8;
  }
  const background = backgroundLuminance(luma);
  const ink = Array.from(
    luma,
    (value) => Math.abs(value - background) > INK_THRESHOLD,
  );
  return { ink, width, height, scale };
}

export class MockRecognizer implements Recognizer {
  constructor(private readonly seed: string) {}

  // Async because the interface is: a real engine awaits a model and a worker
  // round trip. This one has nothing to await and returns on the same tick.
  async recognize(
    bitmap: ImageBitmap,
    options: RecognizeOptions = {},
  ): Promise<readonly Word[]> {
    const { signal, onProgress } = options;
    const { ink, width, height, scale } = sample(bitmap);
    signal?.throwIfAborted();
    onProgress?.(0.4, "read");

    const minRowInk = Math.max(2, Math.round(width * ROW_INK_FRACTION));
    const rowHasInk: boolean[] = [];
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = 0; x < width; x++) {
        if (ink[y * width + x]) {
          count++;
        }
      }
      rowHasInk.push(count >= minRowInk);
    }

    // Lines are separated by blank rows, so no gap tolerance vertically.
    const lines = runsOf(rowHasInk).filter(
      ([top, bottom]) => bottom - top >= MIN_LINE_HEIGHT,
    );
    onProgress?.(0.7, "read");

    const random = mulberry32(hashString(this.seed));
    const words: Word[] = [];
    for (const [top, bottom] of lines) {
      signal?.throwIfAborted();
      const lineHeight = bottom - top;
      const columnHasInk: boolean[] = [];
      for (let x = 0; x < width; x++) {
        let inked = false;
        for (let y = top; y < bottom && !inked; y++) {
          inked = ink[y * width + x];
        }
        columnHasInk.push(inked);
      }
      const glyphs = runsOf(columnHasInk);
      for (const [left, right] of groupIntoWords(glyphs, lineHeight)) {
        // Slivers narrower than a quarter of the line height are punctuation
        // or noise, not words worth a selectable span.
        if (right - left < lineHeight * 0.25) {
          continue;
        }
        // Back to Asset space: boxes are stored in the image's own pixels and
        // are never rewritten when a node moves or resizes.
        const box: Box = {
          x0: left / scale,
          y0: top / scale,
          x1: right / scale,
          y1: bottom / scale,
        };
        words.push({
          ...box,
          text: inventWord(box, random),
          confidence: 0.6 + random() * 0.39,
        });
      }
    }
    onProgress?.(1, "read");
    return words;
  }
}
