import { expect, test, type Page } from "@playwright/test";

/**
 * A page of dark text on a light background: enough real ink for the mock
 * recognizer to project into lines and words. A flat rectangle would be
 * recognized as nothing at all, which is correct but proves nothing.
 */
async function pasteTextImage(page: Page, lines: string[]) {
  await page.evaluate(async (rows) => {
    const width = 640;
    const height = 60 + rows.length * 60;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#111111";
    context.font = "bold 34px sans-serif";
    rows.forEach((row, index) => {
      context.fillText(row, 40, 70 + index * 60);
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "page.png", { type: "image/png" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, lines);
}

const LINES = ["the quick brown fox", "jumps over the", "lazy dog today"];
/** Words drawn above; the recognizer must find at least this many boxes. */
const WORD_COUNT = LINES.join(" ").split(" ").length;

async function wordsOn(page: Page) {
  const node = page.getByTestId("board-node").first();
  await expect(node).toHaveAttribute("data-ocr-status", "done", {
    timeout: 10_000,
  });
  return Number(await node.getAttribute("data-ocr-words"));
}

test.beforeEach(async ({ page }) => {
  await page.goto("#/ocrboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a pasted image is recognized without being asked", async ({ page }) => {
  await pasteTextImage(page, LINES);

  // Nothing was clicked: recognition follows the pixels arriving, not a user
  // action, so paste, drop and reload all reach the same place.
  const found = await wordsOn(page);
  expect(found).toBeGreaterThanOrEqual(WORD_COUNT);
  // Upper bound too: a recognizer that splits every glyph would also clear the
  // lower bound while being useless.
  expect(found).toBeLessThanOrEqual(WORD_COUNT * 2);

  // The badge is for work in progress. A finished image says so by being
  // selectable, not by wearing a label forever.
  await expect(page.getByTestId("ocr-badge")).toHaveCount(0);

  await page.screenshot({ path: "e2e/screenshots/ocr-done.png" });
});

test("boxes land on the ink, not on a grid", async ({ page }) => {
  // One line of text on a tall page: a recognizer emitting boxes on a grid
  // would scatter them down the whole image. Every box must sit in the band
  // the text was actually drawn in.
  await pasteTextImage(page, ["only one line here"]);
  await wordsOn(page);

  const boxes = await page.evaluate(async () => {
    const request = indexedDB.open("canwas");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = db.transaction("assets", "readonly").objectStore("assets");
    const assets = await new Promise<
      { height: number; ocr: { status: string; words?: unknown[] } }[]
    >((resolve, reject) => {
      const all = store.getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    });
    const done = assets.find((asset) => asset.ocr.status === "done");
    return {
      height: done?.height ?? 0,
      words: (done?.ocr.words ?? []) as {
        text: string;
        x0: number;
        y0: number;
        x1: number;
        y1: number;
        confidence: number;
      }[],
    };
  });

  expect(boxes.words.length).toBeGreaterThan(2);
  // Drawn with a 34px font at baseline y=70, so the ink occupies roughly
  // y 45..80 of a 120px-tall image. Nothing may be found outside it.
  for (const word of boxes.words) {
    expect(word.y0).toBeGreaterThan(30);
    expect(word.y1).toBeLessThan(90);
    expect(word.x1).toBeGreaterThan(word.x0);
    expect(word.text.length).toBeGreaterThan(0);
    expect(word.confidence).toBeGreaterThan(0.5);
    expect(word.confidence).toBeLessThanOrEqual(1);
  }
});

test("a result survives a reload and is not recomputed", async ({ page }) => {
  await pasteTextImage(page, LINES);
  const before = await wordsOn(page);

  // Board layout is debounced, so wait for the record before reloading or the
  // reload races the save and the board comes back empty.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open("canwas");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const store = db
          .transaction("boards", "readonly")
          .objectStore("boards");
        const record = await new Promise<{ nodes: unknown[] } | undefined>(
          (resolve, reject) => {
            const get = store.get("ocrboard");
            get.onsuccess = () => resolve(get.result);
            get.onerror = () => reject(get.error);
          },
        );
        return record?.nodes.length ?? 0;
      }),
    )
    .toBe(1);

  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  // Restored from IndexedDB, so it is `done` from the first render rather than
  // passing through queued/running again.
  const node = page.getByTestId("board-node").first();
  await expect(node).toHaveAttribute("data-ocr-status", "done");
  expect(Number(await node.getAttribute("data-ocr-words"))).toBe(before);
});

test("the same image pasted twice is one asset and one job", async ({
  page,
}) => {
  await pasteTextImage(page, LINES);
  const first = await wordsOn(page);
  await pasteTextImage(page, LINES);

  const nodes = page.getByTestId("board-node");
  await expect(nodes).toHaveCount(2);
  // Content-addressed: identical bytes are one Asset, so the second node
  // inherits the finished result instead of queueing its own.
  await expect(nodes.nth(1)).toHaveAttribute("data-ocr-status", "done");
  expect(Number(await nodes.nth(1).getAttribute("data-ocr-words"))).toBe(first);

  const assetCount = await page.evaluate(async () => {
    const request = indexedDB.open("canwas");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = db.transaction("assets", "readonly").objectStore("assets");
    return new Promise<number>((resolve, reject) => {
      const count = store.count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  });
  expect(assetCount).toBe(1);
});
