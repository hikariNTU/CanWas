import { expect, test } from "@playwright/test";

import { pasteTextImage } from "./support";

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/aboutboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("the info panel reports the build and what is on disk", async ({
  page,
}) => {
  await page.getByTestId("about-open").click();
  const panel = page.getByTestId("about-panel");
  await expect(panel).toBeVisible();

  // The build identity is inlined at build time, so it is never "unknown" in a
  // checkout with git available.
  await expect(panel).toContainText("PP-OCRv5 mobile");
  await expect(panel).toContainText("onnxruntime-web");
  await expect(panel).not.toContainText("unknown");

  // Nothing pasted yet: no images, and the mock engine downloads no weights.
  await expect(panel).toContainText("not downloaded yet");
  await expect(page.getByTestId("about-clear-models")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  await pasteTextImage(page, ["something to store"]);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  await page.getByTestId("about-open").click();
  // The image is counted from the stored blob, so it has to have been written
  // before it shows up here — which is the point of showing it.
  await expect
    .poll(
      async () => (await page.getByTestId("about-images").textContent()) ?? "",
    )
    .not.toContain("0 B");
  // Still no weights: the mock downloads nothing.
  await expect(page.getByTestId("about-model-bytes")).toContainText("0 B");

  await page.screenshot({ path: "e2e/screenshots/about.png" });
});
