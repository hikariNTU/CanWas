import { expect, test, type Page } from "@playwright/test";

/**
 * A PNG big enough to be worth compressing: flat dark UI with small text, which
 * is both the case the app is for and the case WebP handles best.
 */
async function pasteScreenshot(page: Page) {
  return page.evaluate(async () => {
    const width = 900;
    const height = 220;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#1e1e1e";
    c.fillRect(0, 0, width, height);
    c.font = "13px ui-monospace, monospace";
    for (let i = 0; i < 5; i++) {
      c.fillStyle = i % 2 ? "#9cdcfe" : "#d4d4d4";
      c.fillText(`export function line ${i} of a screenshot`, 20, 40 + i * 34);
    }
    const blob = await new Promise<Blob>((r) =>
      canvas.toBlob((b) => r(b!), "image/png"),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "shot.png", { type: "image/png" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    return blob.size;
  });
}

function storedAsset(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("canwas");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = db.transaction("assets", "readonly").objectStore("assets");
    const all = await new Promise<{ id: string; blob: Blob; webp?: Blob }[]>(
      (resolve, reject) => {
        const q = store.getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      },
    );
    const asset = all[0];
    return asset
      ? {
          id: asset.id,
          bytes: asset.blob.size,
          type: asset.blob.type,
          webpBytes: asset.webp?.size ?? 0,
          webpType: asset.webp?.type ?? "",
        }
      : null;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/compress");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a pasted screenshot gains a smaller WebP beside it", async ({ page }) => {
  const originalBytes = await pasteScreenshot(page);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  // The picture is on screen before any of this finishes: the node renders from
  // the bytes that arrived, and nothing waits for the encoder.
  const img = page.locator("[data-testid=board-node] img");
  await expect(img).toBeVisible();

  await expect
    .poll(async () => (await storedAsset(page))?.webpBytes ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  const asset = (await storedAsset(page))!;
  expect(asset.webpType).toBe("image/webp");
  // The original is kept, and its bytes are still what the id was hashed from.
  expect(asset.type).toBe("image/png");
  expect(asset.bytes).toBe(originalBytes);
  // Measured around 2.4x on this kind of image; asserted loosely because the
  // encoder is the browser's and its exact output is not ours to pin.
  expect(asset.webpBytes).toBeLessThan(asset.bytes * 0.8);
});

test("the info panel reports what sync would send", async ({ page }) => {
  await pasteScreenshot(page);
  await expect
    .poll(async () => (await storedAsset(page))?.webpBytes ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  await page.getByTestId("about-open").click();
  await expect(page.getByTestId("about-compressed")).toContainText("KB");
  // The saving is stated as a percentage, so it has to be a real one.
  await expect(page.getByTestId("about-compressed")).toContainText("%");
  await page.screenshot({ path: "e2e/screenshots/about-compressed.png" });
});

test("a WebP paste is left alone", async ({ page }) => {
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 220;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#1e1e1e";
    c.fillRect(0, 0, 900, 220);
    c.fillStyle = "#d4d4d4";
    c.font = "13px ui-monospace, monospace";
    for (let i = 0; i < 5; i++) {
      c.fillText(`already compressed line ${i}`, 20, 40 + i * 34);
    }
    // Quality 1 so it lands above the size floor and would otherwise qualify.
    const blob = await new Promise<Blob>((r) =>
      canvas.toBlob((b) => r(b!), "image/webp", 1),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "shot.webp", { type: "image/webp" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  // Re-encoding lossy to lossy compounds artifacts, and the bytes are already
  // in the format sync wants.
  await page.waitForTimeout(2000);
  const asset = (await storedAsset(page))!;
  expect(asset.type).toBe("image/webp");
  expect(asset.webpBytes).toBe(0);
});
