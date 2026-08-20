import { expect, test } from "@playwright/test";

import { PNG } from "./support";

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/addimage");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("the picker puts an image on the board", async ({ page }) => {
  await expect(page.getByTestId("board-node")).toHaveCount(0);

  // The button really does open the OS picker, so the click has to be awaited
  // as a file chooser or it blocks on a dialog nothing answers.
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("add-image").click(),
  ]);
  await chooser.setFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);
  await expect(node).toHaveAttribute("data-node-kind", "image");

  // The picker path is the ingest path, so what arrives is recognized like
  // anything else rather than being a second class of image.
  await expect(node).toHaveAttribute("data-ocr-status", /queued|running|done/);

  // Undoable, like a paste (D17).
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("board-node")).toHaveCount(0);
});

test("the same file can be picked twice in a row", async ({ page }) => {
  const file = {
    name: "photo.png",
    mimeType: "image/png",
    buffer: PNG,
  };
  const input = page.getByTestId("add-image-input");

  await input.setInputFiles(file);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  // The input's value is cleared after each pick, or choosing the same file
  // again fires no change event at all and the button looks broken.
  await input.setInputFiles(file);
  await expect(page.getByTestId("board-node")).toHaveCount(2);
});

test("a mouse is not offered a camera", async ({ page }) => {
  // `capture` is ignored on a desktop browser, so the button would open a
  // second dialog identical to the library one — a control that lies (D78).
  await expect(page.getByTestId("add-image")).toBeVisible();
  await expect(page.getByTestId("take-photo")).toHaveCount(0);
});
