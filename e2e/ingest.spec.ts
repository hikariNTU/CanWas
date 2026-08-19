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

/**
 * The same PNG, with a `pHYs` chunk claiming a screen density.
 *
 * Built in the page rather than checked in as a fixture so the size under test
 * is visible in the test. The CRC is real: Chrome's decoder rejects a chunk
 * whose checksum does not match, and a rejected image is a paste that silently
 * does nothing.
 */
async function pasteImageAtDensity(
  page: Page,
  width: number,
  height: number,
  perMetre: number,
) {
  await page.evaluate(
    async ({ w, h, ppm }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#f5f5f5";
      context.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      const original = new Uint8Array(await blob!.arrayBuffer());

      const table = Array.from({ length: 256 }, (_unused, index) => {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
          value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        return value >>> 0;
      });
      const crc32 = (bytes: Uint8Array) => {
        let value = 0xffffffff;
        for (const byte of bytes) {
          value = table[(value ^ byte) & 0xff]! ^ (value >>> 8);
        }
        return (value ^ 0xffffffff) >>> 0;
      };

      const chunk = new Uint8Array(21);
      const view = new DataView(chunk.buffer);
      view.setUint32(0, 9);
      chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
      view.setUint32(8, ppm);
      view.setUint32(12, ppm);
      chunk[16] = 1; // unit: metres
      view.setUint32(17, crc32(chunk.subarray(4, 17)));

      // Straight after IHDR, which is always the first chunk: 8 bytes of
      // signature, then 4 length + 4 type + 13 data + 4 CRC.
      const at = 8 + 25;
      const tagged = new Uint8Array(original.length + chunk.length);
      tagged.set(original.subarray(0, at));
      tagged.set(chunk, at);
      tagged.set(original.subarray(at), at + chunk.length);

      const transfer = new DataTransfer();
      transfer.items.add(
        new File([tagged], "retina.png", { type: "image/png" }),
      );
      window.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { w: width, h: height, ppm: perMetre },
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
  await page.goto("?engine=mock#/demo");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a pasted image is the size it is", async ({ page }) => {
  await expect(page.getByText("Paste or drop an image here")).toBeVisible();

  const surface = await surfaceBox(page);
  await pasteImage(page, 1600, 1000);

  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);

  // Not fitted to the window, even when it is wider than the window (D59).
  // Scaling it to fit made two different crops of the same screen come out
  // the same size, which is the one comparison a board of screenshots exists
  // to make.
  const box = (await node.boundingBox())!;
  expect(box.width).toBeCloseTo(1600, 0);
  expect(box.height).toBeCloseTo(1000, 0);
  expect(box.width).toBeGreaterThan(surface.width);

  await page.screenshot({ path: "e2e/screenshots/ingest-paste.png" });
});

test("a small image is never enlarged", async ({ page }) => {
  await pasteImage(page, 32, 32);

  const box = (await page.getByTestId("board-node").boundingBox())!;
  expect(box.width).toBeCloseTo(32, 0);
  expect(box.height).toBeCloseTo(32, 0);
});

test("a retina screenshot lands at the size it looked", async ({ page }) => {
  // 5669 px/m is 144 DPI: what a 2x capture carries. The file is 800 pixels
  // across and was 400 points across on the screen it came from.
  await pasteImageAtDensity(page, 800, 600, 5669);

  const box = (await page.getByTestId("board-node").boundingBox())!;
  expect(box.width).toBeCloseTo(400, 0);
  expect(box.height).toBeCloseTo(300, 0);
});

test("an image with no density claim is taken at face value", async ({
  page,
}) => {
  // Same bytes, 72 DPI. Nothing to correct, so nothing is corrected — the
  // guard against dividing every ordinary image by two.
  await pasteImageAtDensity(page, 800, 600, 2835);

  const box = (await page.getByTestId("board-node").boundingBox())!;
  expect(box.width).toBeCloseTo(800, 0);
  expect(box.height).toBeCloseTo(600, 0);
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
  // Away from the floating chrome in the corners. Middle button, because a
  // left drag on empty canvas draws a selection box rather than panning (D54).
  await page.mouse.move(surface.x + surface.width * 0.5, surface.y + 80);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    surface.x + surface.width * 0.5 + 100,
    surface.y + 150,
    { steps: 5 },
  );
  await page.mouse.up({ button: "middle" });

  const after = (await page.getByTestId("board-node").boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(100, 0);
  expect(after.y - before.y).toBeCloseTo(70, 0);
  // Panning must not resize anything.
  expect(after.width).toBeCloseTo(before.width, 0);
});

test("paste lands centred on the cursor, not the viewport centre", async ({
  page,
}) => {
  const surface = await surfaceBox(page);
  // Somewhere clearly off-centre, and clear of the floating chrome.
  const cursor = {
    x: surface.x + surface.width * 0.72,
    y: surface.y + surface.height * 0.34,
  };
  await page.mouse.move(cursor.x, cursor.y);
  await pasteImage(page, 400, 300);

  const box = (await page.getByTestId("board-node").boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(cursor.x, 0);
  expect(box.y + box.height / 2).toBeCloseTo(cursor.y, 0);

  await page.screenshot({ path: "e2e/screenshots/paste-at-cursor.png" });
});

test("paste falls back to the viewport centre when the pointer never entered", async ({
  page,
}) => {
  const surface = await surfaceBox(page);
  await pasteImage(page, 400, 300);

  const box = (await page.getByTestId("board-node").boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(surface.x + surface.width / 2, 0);
  expect(box.y + box.height / 2).toBeCloseTo(surface.y + surface.height / 2, 0);
});
