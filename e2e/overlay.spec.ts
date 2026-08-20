import { expect, test, type Page } from "@playwright/test";

import { pasteTextImage, storedAssets } from "./support";

const LINES = ["the quick brown fox", "jumps over the", "lazy dog today"];

async function recognizedNode(page: Page) {
  const node = page.getByTestId("board-node").first();
  await expect(node).toHaveAttribute("data-ocr-status", "done", {
    timeout: 10_000,
  });
  return node;
}

async function boxOf(page: Page, testId: string) {
  const box = await page.getByTestId(testId).first().boundingBox();
  if (!box) {
    throw new Error(`${testId} has no bounding box`);
  }
  return box;
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/overlayboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("the overlay is inert until the image is entered", async ({ page }) => {
  await pasteTextImage(page, LINES);
  const node = await recognizedNode(page);

  const overlay = page.getByTestId("ocr-overlay");
  await expect(overlay).toHaveCount(1);
  // Present but not selectable: a drag here is still a drag of the node.
  await expect(overlay).not.toHaveAttribute("data-active", "true");

  const before = (await node.boundingBox())!;
  await page.mouse.move(before.x + 40, before.y + 30);
  await page.mouse.down();
  await page.mouse.move(before.x + 140, before.y + 30, { steps: 8 });
  await page.mouse.up();
  const after = (await node.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(100);
});

test("double-click enters the image and its text becomes selectable", async ({
  page,
}) => {
  await pasteTextImage(page, LINES);
  const node = await recognizedNode(page);
  const box = (await node.boundingBox())!;

  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("ocr-overlay")).toHaveAttribute(
    "data-active",
    "true",
  );

  // Entering no longer selects the whole overlay as a side effect. It used to:
  // the double-click that enters landed on text that became selectable the
  // same frame. Since D69 the board is `user-select: none` until an overlay is
  // active, so the click that flips it finds nothing selectable yet — and a
  // stray whole-image selection on every double-click was never the point of
  // this mode anyway. Cleared regardless, so the drag below stands alone.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());

  // Let the multi-click chain lapse. A press within Chrome's double-click
  // window continues the previous gesture at word or paragraph granularity
  // instead of starting a fresh selection — a real user pausing to aim never
  // notices, but an automated drag lands inside the window every time.
  await page.waitForTimeout(600);

  // Dragging across the first line now selects text instead of moving the node.
  // The line's own vertical centre is read from the DOM rather than guessed
  // from the image height: a fraction that happens to graze the top of the band
  // catches one word and looks like a selection bug.
  const words = await page
    .locator("[data-testid=ocr-overlay] [data-word]")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      }),
    );
  const line = words.filter((word) => word.y === words[0].y);
  const first = line[0];
  const last = line[line.length - 1];
  const midline = first.y + first.h / 2;
  // Start on the first word rather than in the margin beside it: the press that
  // begins a drag also has to land on text, or it collapses the selection
  // somewhere the drag then extends from.
  await page.mouse.move(first.x + 2, midline);
  await page.mouse.down();
  await page.mouse.move(last.x + last.w - 2, midline, { steps: 12 });
  await page.mouse.up();

  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selected.trim().length).toBeGreaterThan(0);
  // A line is several words, and they must arrive separated — spans are emitted
  // in reading order precisely so this holds.
  expect(selected.trim().split(/\s+/).length).toBeGreaterThan(1);

  const after = (await node.boundingBox())!;
  expect(Math.round(after.x)).toBe(Math.round(box.x));

  await page.screenshot({ path: "e2e/screenshots/ocr-selection.png" });
});

test("a drag that overshoots the line keeps its selection", async ({
  page,
}) => {
  await pasteTextImage(page, LINES);
  const node = await recognizedNode(page);
  const box = (await node.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.waitForTimeout(600);

  const first = (await page
    .locator("[data-testid=ocr-overlay] [data-word]")
    .first()
    .boundingBox())!;
  const midline = first.y + first.height / 2;

  // Ending well past the last word, in the blank part of the image. Nobody
  // stops a drag exactly on the final glyph, and the overlay's own empty box
  // holds no text position — so it must not take the pointer at all.
  await page.mouse.move(first.x + 2, midline);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, midline, { steps: 12 });
  await page.mouse.up();

  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selected.trim().split(/\s+/).length).toBeGreaterThan(1);
});

test("a selection can run down across lines", async ({ page }) => {
  await pasteTextImage(page, LINES);
  const node = await recognizedNode(page);
  const box = (await node.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.waitForTimeout(600);

  const first = (await page
    .locator("[data-testid=ocr-overlay] [data-word]")
    .first()
    .boundingBox())!;
  await page.mouse.move(first.x + 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4, {
    steps: 12,
  });
  await page.mouse.up();

  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selected.split("\n").length).toBeGreaterThan(1);
});

test("copied text keeps its words and lines apart", async ({ page }) => {
  await pasteTextImage(page, LINES);
  const node = await recognizedNode(page);
  const box = (await node.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

  await page.keyboard.press("Meta+a");
  const text = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );

  // Spans abutting each other with nothing between them copy as one run-on
  // word, which is why each word carries a trailing space and each line is its
  // own block.
  const lines = text.trim().split("\n");
  expect(lines).toHaveLength(LINES.length);
  for (const [index, line] of lines.entries()) {
    expect(line.trim().split(/\s+/)).toHaveLength(
      LINES[index].split(" ").length,
    );
  }
});

test("every span is stretched to the width of the box it covers", async ({
  page,
}) => {
  await pasteTextImage(page, LINES);
  await recognizedNode(page);

  const assets = await storedAssets(page);
  const asset = assets.find((candidate) => candidate.ocr.status === "done")!;
  const words = asset.ocr.words!;
  const image = await boxOf(page, "board-node");

  // Entered first: the spans are only laid out while the node is being read
  // (D77), which is the only state in which their geometry means anything.
  await page.mouse.dblclick(
    image.x + image.width / 2,
    image.y + image.height / 2,
  );
  await expect(page.getByTestId("ocr-overlay")).toHaveAttribute(
    "data-active",
    "true",
  );

  const spans = await page
    .locator("[data-testid=ocr-overlay] [data-word]")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          width: rect.width,
          text: element.textContent,
        };
      }),
    );

  expect(spans.length).toBe(words.length);
  const pixelsPerAssetPixel = image.width / asset.width;
  for (const [index, span] of spans.entries()) {
    const word = words[index];
    const expectedWidth = (word.x1 - word.x0) * pixelsPerAssetPixel;
    const expectedLeft = image.x + word.x0 * pixelsPerAssetPixel;
    // The scaleX correction is the whole point: without it a span is as wide as
    // its invented text happens to render, the error compounds along the line,
    // and the highlight stops matching the pixels underneath.
    // Measured exact in practice; the half pixel is for subpixel layout noise,
    // not for a correction that is merely close.
    expect(Math.abs(span.width - expectedWidth)).toBeLessThan(0.5);
    expect(Math.abs(span.left - expectedLeft)).toBeLessThan(0.5);
  }
});

test("only one image is selectable at a time", async ({ page }) => {
  await pasteTextImage(page, LINES);
  await recognizedNode(page);
  // Different ink, so a different content hash and a second asset.
  await pasteTextImage(page, ["a second picture", "with other words"]);
  await expect(page.getByTestId("board-node")).toHaveCount(2);
  await expect(page.getByTestId("ocr-overlay")).toHaveCount(2);

  const second = page.getByTestId("board-node").nth(1);
  await expect(second).toHaveAttribute("data-ocr-status", "done", {
    timeout: 10_000,
  });
  const box = (await second.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

  // Native selection follows DOM order, not board position, so a drag across
  // two active overlays would interleave two images' text into nonsense.
  await expect(
    page.locator("[data-testid=ocr-overlay][data-active]"),
  ).toHaveCount(1);
});

test("escape leaves reading mode and gives the board its keys back", async ({
  page,
}) => {
  await pasteTextImage(page, LINES);
  const node = await recognizedNode(page);
  const box = (await node.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("ocr-overlay")).toHaveAttribute(
    "data-active",
    "true",
  );

  // Backspace while reading belongs to the text selection, not to the board:
  // the node must survive it.
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(
    page.locator("[data-testid=ocr-overlay][data-active]"),
  ).toHaveCount(0);
});

test("an indented line lays nothing over the space to its left", async ({
  page,
}) => {
  await pasteTextImage(page, LINES);
  const node = await recognizedNode(page);
  const box = (await node.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("ocr-overlay")).toHaveAttribute(
    "data-active",
    "true",
  );

  const line = page.locator("[data-testid=ocr-overlay] [data-line='0']");
  const lineBox = (await line.boundingBox())!;
  const firstWord = (await line.locator("[data-word]").first().boundingBox())!;
  const overlayBox = (await boxOf(page, "ocr-overlay"))!;

  // The indent is real — the text does not start at the overlay's edge — and
  // the box starts where the text does. It was padding, which is *inside* the
  // element: the box began at the overlay's left edge and its empty half sat
  // over whatever else was on that band. On a two-column form that is another
  // line of text, unreachable behind a slab holding no text position of its
  // own.
  expect(firstWord.x - overlayBox.x).toBeGreaterThan(4);
  expect(Math.abs(lineBox.x - firstWord.x)).toBeLessThan(2);

  // Said again as the pointer sees it, since that is where it went wrong.
  const covering = await page.evaluate(
    ([x, y]) =>
      document
        .elementsFromPoint(x, y)
        .some((element) => element.getAttribute("data-line") === "0"),
    [overlayBox.x + 2, firstWord.y + firstWord.height / 2] as const,
  );
  expect(covering).toBe(false);
});
