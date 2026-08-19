import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

import type { Word } from "@/board/types";

/**
 * The transparent text layer over a recognized image.
 *
 * One `<span>` per Word, positioned from the Word's Asset-space box, holding
 * the recognized string in transparent text. The browser's own selection then
 * lands on the right pixels: no custom hit-testing, no custom highlight, and
 * copy works because there is real text to copy.
 *
 * Spans are emitted in reading order — line by line, left to right — because
 * native selection follows DOM order. Emitting them in any other order would
 * produce scrambled text on a drag across a line.
 */

/**
 * Measures every word at the size it will actually render at, in one offscreen
 * pass.
 *
 * Two earlier attempts were not exact enough. `canvas.measureText` came out
 * about 1% off what the same font rendered as a span. Measuring in the DOM at
 * one reference size and scaling linearly was closer but still drifted, because
 * glyph advances are not exactly linear in font size — hinting rounds them at
 * small sizes, which showed up as a ~2% error on short words.
 *
 * Measuring at the real size costs nothing extra here: these font sizes are in
 * world units, so they do not change when the board is panned or zoomed. Only a
 * resize of the node itself invalidates them.
 */
function measureWidths(
  words: readonly Word[],
  fontSizes: readonly number[],
  // Not read. Present so the measurement is redone when the real font replaces
  // the fallback, and so the reason is visible at the call site.
  _fontRevision: number,
): number[] {
  if (words.length === 0) {
    return [];
  }
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre;line-height:1";

  const probes = words.map((word, index) => {
    const span = document.createElement("span");
    // The same class the real spans carry, so the same font is measured.
    span.className = "ocr-word";
    // Each probe is taken out of flow so it starts at x = 0. Laid out as inline
    // siblings on one line they each begin at a fractional offset, and glyph
    // positions snap to that offset — enough to move a measured width by half a
    // pixel, which is exactly the error this measurement exists to remove.
    span.style.position = "absolute";
    span.style.top = "0";
    span.style.left = "0";
    span.style.fontSize = `${fontSizes[index]}px`;
    span.textContent = word.text;
    host.append(span);
    return span;
  });
  // Appended once and read once: the whole set costs one layout, not one each.
  document.body.append(host);
  const widths = probes.map((span) => span.getBoundingClientRect().width);
  host.remove();
  return widths;
}

/**
 * Bumps a counter whenever the set of loaded fonts changes, so widths are
 * re-measured against the font that will actually paint.
 *
 * This started as `document.fonts.status === "loaded"`, which is a trap: the
 * status is "loaded" whenever nothing is *pending*, including before the page
 * has asked for the font at all. Measuring then captured the fallback's
 * advances, and nothing ever invalidated them — every span came out about 1.5%
 * too wide, drifting the highlight off the pixels it was supposed to cover.
 *
 * `fonts.ready` resolves once, and `loadingdone` covers fonts that arrive
 * later, so both are watched.
 */
/** Must name the same face as `.ocr-word` in index.css. */
const OVERLAY_FONT_QUERY = '700 100px "Noto Sans"';

function useFontRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const bump = () => {
      if (!cancelled) {
        setRevision((current) => current + 1);
      }
    };
    // Asks for the face by name rather than only waiting on events. Both
    // `fonts.ready` and `loadingdone` can fire before this effect subscribes —
    // `ready` resolves whenever nothing is pending, including before the page
    // has asked for the font — which left the fallback's metrics baked in for
    // the life of the board, intermittently and only on a cold font cache.
    // `fonts.load` resolves against the face itself, whenever it arrives.
    void document.fonts.load(OVERLAY_FONT_QUERY).then(bump);
    void document.fonts.ready.then(bump);
    document.fonts.addEventListener("loadingdone", bump);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener("loadingdone", bump);
    };
  }, []);
  return revision;
}

/**
 * Groups words into lines, so the copied text has line breaks in it.
 *
 * The recognizer emits words line by line, and every word on a line shares the
 * line's band, so consecutive words with the same top are one line. Nothing in
 * the Word type records this — it does not need to, since the order already
 * carries it.
 */
function groupIntoLines(words: readonly Word[]): number[][] {
  const lines: number[][] = [];
  let previousTop: number | null = null;
  for (const [index, word] of words.entries()) {
    if (word.y0 !== previousTop) {
      lines.push([]);
      previousTop = word.y0;
    }
    lines[lines.length - 1].push(index);
  }
  return lines;
}

interface OcrOverlayProps {
  words: readonly Word[];
  /** Intrinsic image size, the space the boxes are expressed in. */
  assetWidth: number;
  /** Rendered node width in world units. */
  nodeWidth: number;
  /** Only the node being read is selectable — see the cross-node note below. */
  active: boolean;
}

export function OcrOverlay({
  words,
  assetWidth,
  nodeWidth,
  active,
}: OcrOverlayProps) {
  const fontRevision = useFontRevision();
  // Asset space to world space. Images resize with a locked aspect ratio, so
  // one factor covers both axes.
  const scale = assetWidth > 0 ? nodeWidth / assetWidth : 0;
  const fontSizes = useMemo(
    () => words.map((word) => (word.y1 - word.y0) * scale),
    [words, scale],
  );
  // `fontRevision` is a dependency without being an argument: it is what forces
  // the re-measure once the real font replaces the fallback.
  const widths = useMemo(
    () => measureWidths(words, fontSizes, fontRevision),
    [words, fontSizes, fontRevision],
  );

  if (words.length === 0 || scale <= 0) {
    return null;
  }

  return (
    <div
      data-testid="ocr-overlay"
      data-active={active || undefined}
      // Cross-node selection is deliberately blocked: native selection follows
      // DOM order, which has nothing to do with where nodes sit on the board,
      // so a drag across two images would yield interleaved nonsense. Exactly
      // one overlay is selectable at a time.
      className={clsx(
        "absolute inset-0",
        active ? "cursor-text select-text" : "pointer-events-none select-none",
      )}
    >
      {groupIntoLines(words).map((line, lineIndex) => {
        const head = words[line[0]];
        // Every word on a line shares the line's band, so the line owns the
        // font size and the vertical placement and the words only have to
        // agree on where they start horizontally.
        const fontSize = (head.y1 - head.y0) * scale;
        return (
          // The outer block stays in normal flow and has no height of its own.
          // It exists so the lines are separated by a block boundary, which is
          // what a copied selection turns into a line break; the inner block
          // does the placing.
          <div key={lineIndex}>
            {/* One block per line, stretched across the whole overlay and pushed
              in with padding rather than positioned at the first word.


              The width is what makes selection behave. With each word its own
              absolutely positioned box there were no line boxes to extend
              along: a drag that ended five pixels past the last glyph landed
              on an element holding no text position and the whole selection
              collapsed. Nobody releases the mouse exactly on the final
              letter. */}
            <div
              className="absolute right-0 left-0 whitespace-nowrap"
              style={{
                top: head.y0 * scale,
                paddingLeft: head.x0 * scale,
                fontSize,
                lineHeight: 1,
              }}
            >
              {line.map((index, positionInLine) => {
                const word = words[index];
                const naturalWidth = widths[index];
                const boxWidth = (word.x1 - word.x0) * scale;
                // Without this correction the highlight drifts further right
                // with every word on a line, and stops matching the pixels
                // underneath. The transform does not affect layout, so the flow
                // below still advances by the untransformed width.
                const stretch = naturalWidth > 0 ? boxWidth / naturalWidth : 1;
                const previous =
                  positionInLine === 0 ? null : words[line[positionInLine - 1]];
                const gap = previous
                  ? (word.x0 - previous.x0) * scale -
                    widths[line[positionInLine - 1]]
                  : 0;
                const isLast = positionInLine === line.length - 1;
                return (
                  <span
                    key={index}
                    data-word
                    className="ocr-word inline-block origin-top-left align-top whitespace-pre text-transparent"
                    style={{
                      // Pinned to the measured width so the trailing space below
                      // overflows instead of widening the box the correction is
                      // built from.
                      width: naturalWidth,
                      marginLeft: gap,
                      transform: `scaleX(${stretch})`,
                    }}
                  >
                    {/* Spans that abut with nothing between them copy as one
                      run-on word, so every word but the last carries a space. */}
                    {isLast ? word.text : `${word.text} `}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
