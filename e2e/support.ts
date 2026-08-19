import type { Page } from "@playwright/test";

/**
 * Builds a page of dark text on white in the browser and dispatches it as a
 * synthetic paste — the only clipboard path an automated browser can drive,
 * and the reason ingest reads `event.clipboardData` (D21).
 *
 * Real ink matters: the mock recognizer projects the image to find its lines
 * and words (D41), so a flat rectangle would correctly yield nothing.
 */
export async function pasteTextImage(page: Page, lines: string[]) {
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

/** Every stored asset's intrinsic size and recognition result. */
export function storedAssets(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("canwas");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = db.transaction("assets", "readonly").objectStore("assets");
    return new Promise<
      {
        id: string;
        width: number;
        height: number;
        ocr: {
          status: string;
          words?: {
            text: string;
            x0: number;
            y0: number;
            x1: number;
            y1: number;
            confidence: number;
          }[];
        };
      }[]
    >((resolve, reject) => {
      const all = store.getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    });
  });
}
