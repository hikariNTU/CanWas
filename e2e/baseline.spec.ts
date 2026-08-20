import { expect, test } from "@playwright/test";

test("opening a board is not an edit", async ({ page }) => {
  await page.goto("?engine=mock#/quietopen");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 100;
    c.height = 80;
    c.getContext("2d")!.fillRect(0, 0, 100, 80);
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    const t = new DataTransfer();
    t.items.add(new File([b!], "s.png", { type: "image/png" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: t, bubbles: true }),
    );
  });
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await page.waitForTimeout(1200);

  const read = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("canwas");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const r = open.result
              .transaction("boards", "readonly")
              .objectStore("boards")
              .get("quietopen");
            r.onsuccess = () => resolve(r.result?.updatedAt ?? 0);
            r.onerror = () => reject(r.error);
          };
        }),
    );
  const edited = await read();
  expect(edited).toBeGreaterThan(0);

  // Reopen and touch nothing. "Last edited" is what the board list is sorted
  // by, and it must not mean "last opened" — and with two tabs, a save on open
  // is one tab writing its view of the board over the other's.
  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await read()).toBe(edited);
});
