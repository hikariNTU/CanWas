import { BLANK_INDEX, CHARSET } from "@/ocr/paddle/charset";

/**
 * Greedy CTC decoding, keeping the timestep each character was read at.
 *
 * The timesteps are the reason this is not three lines. A CTC head reads a line
 * left to right in T slices, so the slice a character survives in says roughly
 * where in the line it sits — which is what lets one detected line be split
 * back into separately selectable words instead of one box holding a sentence.
 */

export interface DecodedCharacter {
  text: string;
  /** Fraction along the line, 0..1, where this character starts and ends. */
  start: number;
  end: number;
  confidence: number;
}

export interface DecodedLine {
  text: string;
  characters: DecodedCharacter[];
  confidence: number;
}

/** The label the charset uses for a space, which is where words are split. */
const SPACE = " ";

/**
 * Whether the graph already ends in a softmax.
 *
 * PaddleOCR's exported rec graph does, but the research notes call the output
 * "CTC logits" and a future export might not, so it is measured once per run
 * rather than assumed: a row of probabilities sums to one, a row of logits does
 * not. Getting this wrong would not change which character wins, only whether
 * the confidence attached to it means anything.
 */
function rowIsNormalized(
  logits: Float32Array,
  offset: number,
  classes: number,
): boolean {
  let sum = 0;
  for (let i = 0; i < classes; i++) {
    sum += logits[offset + i];
  }
  return Math.abs(sum - 1) < 0.05;
}

export function decodeLine(
  logits: Float32Array,
  timesteps: number,
  classes: number,
  lineOffset: number,
): DecodedLine {
  const normalized = rowIsNormalized(logits, lineOffset, classes);
  const characters: DecodedCharacter[] = [];
  let previous = -1;
  let confidenceTotal = 0;

  for (let t = 0; t < timesteps; t++) {
    const offset = lineOffset + t * classes;
    let best = 0;
    let bestValue = logits[offset];
    for (let index = 1; index < classes; index++) {
      const value = logits[offset + index];
      if (value > bestValue) {
        bestValue = value;
        best = index;
      }
    }

    // CTC's two rules: a blank emits nothing, and a repeat of the previous
    // label is the same character held across slices, not a second one.
    const repeated = best === previous;
    previous = best;
    if (best === BLANK_INDEX || repeated) {
      continue;
    }

    let probability = bestValue;
    if (!normalized) {
      let sum = 0;
      for (let index = 0; index < classes; index++) {
        sum += Math.exp(logits[offset + index] - bestValue);
      }
      probability = 1 / sum;
    }

    confidenceTotal += probability;
    characters.push({
      text: CHARSET[best] ?? "",
      start: t / timesteps,
      end: (t + 1) / timesteps,
      confidence: probability,
    });
  }

  return {
    text: characters.map((character) => character.text).join(""),
    characters,
    confidence:
      characters.length === 0 ? 0 : confidenceTotal / characters.length,
  };
}

export interface DecodedWord {
  text: string;
  /** Fractions along the line, 0..1. */
  start: number;
  end: number;
  confidence: number;
}

/**
 * Splits a decoded line into words at its spaces.
 *
 * Split only at real spaces, never per character. Chinese writes without them,
 * so a per-character split would be right for selection granularity and wrong
 * for everything else — the overlay puts a space between consecutive words, and
 * copying a Chinese line would come back with a space between every character.
 */
export function splitIntoWords(line: DecodedLine): DecodedWord[] {
  const words: DecodedWord[] = [];
  let current: DecodedCharacter[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const confidence =
      current.reduce((total, character) => total + character.confidence, 0) /
      current.length;
    words.push({
      text: current.map((character) => character.text).join(""),
      start: current[0].start,
      end: current[current.length - 1].end,
      confidence,
    });
    current = [];
  };

  for (const character of line.characters) {
    if (character.text === SPACE) {
      flush();
      continue;
    }
    current.push(character);
  }
  flush();
  return words;
}
