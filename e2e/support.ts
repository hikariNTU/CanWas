import type { Page } from "@playwright/test";

/** A 64x64 white PNG, inline so the tests carry no binary fixture. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3PMQ0AMAzAsPInvYLYYVWK" +
    "ESTzjhsd8KsBrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGt" +
    "Aa0BrQGtAa0BbQHKU9LC7/CP1AAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Builds a page of dark text on white in the browser and dispatches it as a
 * synthetic paste — the only clipboard path an automated browser can drive,
 * and the reason ingest reads `event.clipboardData` (D21).
 *
 * Real ink matters: the mock recognizer projects the image to find its lines
 * and words (D41), so a flat rectangle would correctly yield nothing.
 */
export async function pasteTextImage(
  page: Page,
  lines: string[],
  options: { fontSize?: number; dark?: boolean } = {},
) {
  await page.evaluate(
    async ({ rows, fontSize, dark }) => {
      const scale = fontSize / 34;
      const width = Math.round(640 * Math.max(scale, 0.35));
      const height = Math.round(
        (60 + rows.length * 60) * Math.max(scale, 0.35),
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = dark ? "#1e1e1e" : "#ffffff";
      context.fillRect(0, 0, width, height);
      context.fillStyle = dark ? "#d4d4d4" : "#111111";
      context.font = `bold ${fontSize}px sans-serif`;
      rows.forEach((row, index) => {
        context.fillText(
          row,
          Math.round(40 * Math.max(scale, 0.35)),
          Math.round((70 + index * 60) * Math.max(scale, 0.35)),
        );
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
    },
    {
      rows: lines,
      fontSize: options.fontSize ?? 34,
      dark: options.dark ?? false,
    },
  );
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
