import { expect, test, type Page } from "@playwright/test";

async function pasteImage(page: Page, size = 300) {
  await page.evaluate(async (s) => {
    const canvas = document.createElement("canvas");
    canvas.width = s;
    canvas.height = s;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#cbe8b7";
    context.fillRect(0, 0, s, s);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "p.png", { type: "image/png" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, size);
}

/** Counts records in an object store, straight from IndexedDB. */
function countStore(page: Page, store: string) {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("canwas");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(name)) {
            resolve(0);
            return;
          }
          const request = db
            .transaction(name, "readonly")
            .objectStore(name)
            .count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        };
      }),
    store,
  );
}

/** Node count for a board, read straight from the stored record. */
function storedNodeCount(page: Page, boardId: string) {
  return page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("canwas");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("boards")) {
            resolve(-1);
            return;
          }
          const request = db
            .transaction("boards", "readonly")
            .objectStore("boards")
            .get(id);
          request.onsuccess = () => resolve(request.result?.nodes.length ?? -1);
        };
      }),
    boardId,
  );
}

test("a pasted image survives a reload", async ({ page }) => {
  await page.goto("/CanWas/#/board/persist-me");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  await pasteImage(page);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  const before = (await page.getByTestId("board-node").boundingBox())!;

  // Asset bytes are written immediately, but board layout is debounced — wait
  // for the *board* record, or the reload races the save.
  await expect.poll(() => countStore(page, "assets")).toBe(1);
  await expect.poll(() => storedNodeCount(page, "persist-me")).toBe(1);

  await page.reload();
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  // Object URLs do not survive a reload — this proves they were recreated
  // from the stored Blob rather than restored as dead references.
  const image = page.locator("[data-testid=board-node] img");
  await expect(image).toHaveJSProperty("naturalWidth", 300);

  const after = (await page.getByTestId("board-node").boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);

  await page.screenshot({ path: "e2e/screenshots/persisted.png" });
});

test("viewport is restored but does not count as an edit", async ({ page }) => {
  await page.goto("/CanWas/#/board/viewport-me");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await pasteImage(page);
  await expect.poll(() => countStore(page, "boards")).toBe(1);

  const readUpdatedAt = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("canwas");
          open.onsuccess = () => {
            const request = open.result
              .transaction("boards", "readonly")
              .objectStore("boards")
              .get("viewport-me");
            request.onsuccess = () => resolve(request.result.updatedAt);
          };
        }),
    );

  await expect.poll(readUpdatedAt).toBeGreaterThan(0);
  const editedAt = await readUpdatedAt();

  // Pan only. "Last edited" must not degrade into "last opened".
  const surface = (await page.getByTestId("canvas-surface").boundingBox())!;
  await page.mouse.move(surface.x + 400, surface.y + 300);
  await page.mouse.down();
  await page.mouse.move(surface.x + 520, surface.y + 380, { steps: 6 });
  await page.mouse.up();

  await page.waitForTimeout(1400);
  expect(await readUpdatedAt()).toBe(editedAt);

  const zoomBefore = await page.getByTestId("zoom-reset").textContent();
  await page.reload();
  await expect(page.getByTestId("zoom-reset")).toHaveText(zoomBefore!);
  const restored = (await page.getByTestId("board-node").boundingBox())!;
  expect(restored.x).toBeGreaterThan(0);
});

test("deleting a board leaves its assets to the startup sweep", async ({
  page,
}) => {
  await page.goto("/CanWas/");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  await pasteImage(page);
  await expect.poll(() => countStore(page, "assets")).toBe(1);

  await page.getByTestId("board-menu").click();
  await page.getByTestId("menu-delete-board").click();
  await page.getByTestId("confirm-delete").click();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  // Deleting the board does not reclaim bytes — sweeping mid-session could
  // take assets a still-open board is using (D14).
  expect(await countStore(page, "assets")).toBe(1);

  // The next startup reclaims them.
  await page.reload();
  await expect.poll(() => countStore(page, "assets")).toBe(0);
});
