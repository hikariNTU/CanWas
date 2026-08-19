import { expect, test, type Page } from "@playwright/test";

/**
 * Builds a PNG in the page and dispatches it as a synthetic paste.
 *
 * This is the only cross-browser-automatable paste path, and it is why ingest
 * reads `event.clipboardData` rather than `navigator.clipboard.read()` (D21).
 */
async function pasteImage(page: Page, width: number, height: number) {
  await page.evaluate(
    async ({ w, h }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#f5f5f5";
      context.fillRect(0, 0, w, h);
      context.fillStyle = "#0a0a0a";
      context.font = `bold ${Math.round(h / 6)}px sans-serif`;
      context.fillText("CanWas", w * 0.08, h * 0.55);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob!], "shot.png", { type: "image/png" }));
      window.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { w: width, h: height },
  );
}

async function surfaceBox(page: Page) {
  const box = await page.getByTestId("canvas-surface").boundingBox();
  if (!box) {
    throw new Error("no canvas surface");
  }
  return box;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/CanWas/#/board/demo");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("pasting an image creates a node fitted to the viewport", async ({
  page,
}) => {
  await expect(page.getByText("Paste or drop an image here")).toBeVisible();

  const surface = await surfaceBox(page);
  await pasteImage(page, 1600, 1000);

  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);

  const box = (await node.boundingBox())!;
  // Never larger than ~40% of the visible canvas in either axis (D19).
  expect(box.width).toBeLessThanOrEqual(surface.width * 0.4 + 1);
  expect(box.height).toBeLessThanOrEqual(surface.height * 0.4 + 1);
  // Aspect ratio preserved.
  expect(box.width / box.height).toBeCloseTo(1.6, 1);

  await page.screenshot({ path: "e2e/screenshots/ingest-paste.png" });
});

test("a small image is never enlarged", async ({ page }) => {
  await pasteImage(page, 32, 32);

  const box = (await page.getByTestId("board-node").boundingBox())!;
  expect(box.width).toBeCloseTo(32, 0);
  expect(box.height).toBeCloseTo(32, 0);
});

test("pasting identical bytes twice reuses one asset", async ({ page }) => {
  await pasteImage(page, 400, 300);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await pasteImage(page, 400, 300);
  await expect(page.getByTestId("board-node")).toHaveCount(2);

  // Two nodes, one Asset: content-addressed storage means both <img> elements
  // point at the same object URL.
  const sources = await page
    .locator("[data-testid=board-node] img")
    .evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).src),
    );
  expect(sources).toHaveLength(2);
  expect(sources[0]).toBe(sources[1]);

  // The second node cascades so it does not hide the first.
  const boxes = await page.getByTestId("board-node").all();
  const first = (await boxes[0].boundingBox())!;
  const second = (await boxes[1].boundingBox())!;
  expect(second.x).not.toBeCloseTo(first.x, 0);

  await page.screenshot({ path: "e2e/screenshots/ingest-duplicate.png" });
});

test("pasted node keeps its world position while panning and zooming", async ({
  page,
}) => {
  await pasteImage(page, 800, 600);
  const before = (await page.getByTestId("board-node").boundingBox())!;

  const surface = await surfaceBox(page);
  await page.mouse.move(surface.x + 40, surface.y + 40);
  await page.mouse.down();
  await page.mouse.move(surface.x + 140, surface.y + 110, { steps: 5 });
  await page.mouse.up();

  const after = (await page.getByTestId("board-node").boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(100, 0);
  expect(after.y - before.y).toBeCloseTo(70, 0);
  // Panning must not resize anything.
  expect(after.width).toBeCloseTo(before.width, 0);
});
