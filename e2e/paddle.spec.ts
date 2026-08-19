import { expect, test } from "@playwright/test";

import { pasteTextImage, storedAssets } from "./support";

/**
 * The only test that runs the real engine, and therefore the only one that
 * downloads 21 MB of weights. Opt in with `E2E_REAL_OCR=1`.
 *
 * Everything else in the suite runs on `?engine=mock`, which is not a way of
 * avoiding the truth — the mock proves the plumbing and the overlay, and this
 * proves the plumbing was pointed at something that can read.
 */
test.skip(
  !process.env.E2E_REAL_OCR,
  "set E2E_REAL_OCR=1 to run the real engine",
);

const LINES = ["the quick brown fox", "jumps over the", "lazy dog today"];

test("PP-OCRv5 reads a pasted screenshot", async ({ page }) => {
  // The first run fetches both graphs and compiles them.
  test.setTimeout(240_000);

  await page.goto("#/realocr");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await pasteTextImage(page, LINES);

  const node = page.getByTestId("board-node").first();
  await expect(node).toHaveAttribute("data-ocr-status", "done", {
    timeout: 200_000,
  });

  const assets = await storedAssets(page);
  const asset = assets.find((candidate) => candidate.ocr.status === "done")!;
  const words = asset.ocr.words!;
  console.log(
    "read:",
    words
      .map(
        (word) => `${word.text}@${Math.round(word.x0)},${Math.round(word.y0)}`,
      )
      .join(" "),
  );

  const text = words
    .map((word) => word.text)
    .join(" ")
    .toLowerCase();
  for (const expected of LINES.join(" ").split(" ")) {
    expect(text).toContain(expected);
  }

  // The overlay has only ever been judged against the mock's boxes. Real
  // detections are wider than the ink and come from a different code path, so
  // the highlight is worth looking at once with them.
  const box = (await node.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("ocr-overlay")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.keyboard.press("Meta+a");
  const selected = await page.evaluate(
    () => window.getSelection()?.toString() ?? "",
  );
  expect(selected.trim().split("\n")).toHaveLength(LINES.length);
  expect(selected.toLowerCase()).toContain("quick brown fox");

  await page.screenshot({ path: "e2e/screenshots/ocr-real.png" });
});

test("PP-OCRv5 reads small dark-theme UI text", async ({ page }) => {
  test.setTimeout(240_000);

  // 13px light-on-dark is what a screenshot of an editor or a terminal
  // actually looks like, and it is the case the preprocessing upscale exists
  // for — engines want around 30px of cap height.
  await page.goto("#/realocrsmall");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await pasteTextImage(page, LINES, { fontSize: 13, dark: true });

  const node = page.getByTestId("board-node").first();
  await expect(node).toHaveAttribute("data-ocr-status", "done", {
    timeout: 200_000,
  });

  const assets = await storedAssets(page);
  const asset = assets.find((candidate) => candidate.ocr.status === "done")!;
  const text = asset.ocr
    .words!.map((word) => word.text)
    .join(" ")
    .toLowerCase();
  console.log("small:", text);

  // Measured: every word, at 13px. Asserted exactly rather than with a margin,
  // because the model is deterministic — a margin here would only hide the day
  // the preprocessing stops upscaling.
  for (const word of LINES.join(" ").split(" ")) {
    expect(text).toContain(word);
  }
});
