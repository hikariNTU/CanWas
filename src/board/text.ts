import { createId } from "@/lib/id";

import type { TextNode } from "@/board/types";

/**
 * Pasted text is truncated rather than refused.
 *
 * A board is a spatial reference tool, not a document editor: dropping a whole
 * article onto the canvas produces a node nobody can read at any zoom, and one
 * that costs layout on every frame. The cap keeps a paste recognisable as what
 * it came from while staying a glanceable card.
 */
export const MAX_TEXT_LENGTH = 2000;

const ELLIPSIS = "…";

/**
 * Preset sizes rather than a free number. A reference board wants a handful of
 * distinguishable levels — heading, body, caption — not arbitrary values that
 * make two notes look accidentally different.
 */
export const FONT_SIZES = [12, 16, 24, 40] as const;

export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_TEXT_WIDTH = 320;
/** Enough for one line, before the first measurement replaces it. */
export const DEFAULT_TEXT_HEIGHT = 24;

export function truncateText(text: string): string {
  const normalised = text.replace(/\r\n/g, "\n").trimEnd();
  return normalised.length <= MAX_TEXT_LENGTH
    ? normalised
    : normalised.slice(0, MAX_TEXT_LENGTH - 1).trimEnd() + ELLIPSIS;
}

export function createTextNode(
  x: number,
  y: number,
  text = "",
  width = DEFAULT_TEXT_WIDTH,
): TextNode {
  return {
    id: createId(),
    kind: "text",
    x,
    y,
    w: width,
    h: DEFAULT_TEXT_HEIGHT,
    text: truncateText(text),
    fontSize: DEFAULT_FONT_SIZE,
  };
}
