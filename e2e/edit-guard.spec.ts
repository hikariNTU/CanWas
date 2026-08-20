import { expect, test, type Page } from "@playwright/test";

/**
 * Editing a board that has a remote nobody can reach (D74).
 *
 * The state is reached honestly: a board is synced against the fake remote,
 * which leaves a real sync base in this device's database, and then reloaded
 * *without* `?sync=fake`. What is left is a board that has synced before and
 * cannot sync now — which is what an expired token looks like from the board's
 * point of view, and what most reloads an hour into a session actually are.
 */

const BOARD = "guarded";

async function pasteImage(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 150;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#eeeeee";
    context.fillRect(0, 0, 200, 150);
    context.fillStyle = "#111111";
    context.font = "bold 24px sans-serif";
    context.fillText("hello", 16, 60);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "s.png", { type: "image/png" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** How many nodes this device has actually written to disk. */
function storedNodes(page: Page) {
  return page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("canwas");
        open.onsuccess = () => {
          const read = open.result
            .transaction("boards", "readonly")
            .objectStore("boards")
            .get(id);
          read.onsuccess = () =>
            resolve(
              ((read.result?.nodes as unknown[] | undefined) ?? []).length,
            );
        };
      }),
    BOARD,
  );
}

/** Whether this device has recorded a remote copy of the board. */
function hasBase(page: Page) {
  return page.evaluate(
    (id) =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("canwas");
        open.onsuccess = () => {
          const read = open.result
            .transaction("sync", "readonly")
            .objectStore("sync")
            .get(id);
          read.onsuccess = () => resolve(read.result != null);
        };
      }),
    BOARD,
  );
}

/** A synced board, then a reload with no way to sync. */
async function cutOff(page: Page) {
  await page.goto(`?engine=mock&sync=fake#/${BOARD}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await pasteImage(page);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await expect.poll(() => hasBase(page), { timeout: 15000 }).toBe(true);
  // The local save is what the reload reads back, and it is debounced
  // separately from the round. Reloading between the two gives an empty board
  // and a test that fails for a reason that is nothing to do with the guard.
  await expect.poll(() => storedNodes(page), { timeout: 15000 }).toBe(1);

  await page.goto(`?engine=mock#/${BOARD}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await expect(page.getByTestId("board-node")).toHaveCount(1);
}

test("a board with an unreachable remote holds the first edit", async ({
  page,
}) => {
  await cutOff(page);

  const node = page.getByTestId("board-node");
  await node.click();
  await page.keyboard.press("Delete");

  await expect(page.getByTestId("stale-edit-dialog")).toBeVisible();
  // Held, not applied. The board is exactly as the reload found it.
  await expect(node).toHaveCount(1);
});

test("edit anyway lands the held edit, and stops asking", async ({ page }) => {
  await cutOff(page);

  await page.getByTestId("board-node").click();
  await page.keyboard.press("Delete");
  await page.getByTestId("edit-anyway").click();

  // The delete that raised the dialog is the delete that happens — a held
  // change is a function of the current nodes, so it replays rather than being
  // repeated by hand.
  await expect(page.getByTestId("board-node")).toHaveCount(0);
  await expect(page.getByTestId("stale-edit-dialog")).toBeHidden();

  // And the answer holds for the rest of the session.
  await pasteImage(page);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await expect(page.getByTestId("stale-edit-dialog")).toBeHidden();
});

test("a rename is guarded too, though it skips the history stack", async ({
  page,
}) => {
  await cutOff(page);

  await page.getByTestId("board-name").click();
  const field = page.getByTestId("board-name-input");
  await field.fill("Renamed While Cut Off");
  await field.press("Enter");

  await expect(page.getByTestId("stale-edit-dialog")).toBeVisible();
  await expect(page.getByTestId("board-name")).toHaveText(BOARD);

  await page.getByTestId("edit-anyway").click();
  await expect(page.getByTestId("board-name")).toHaveText(
    "Renamed While Cut Off",
  );
});

test("a board that has never synced is never guarded", async ({ page }) => {
  await page.goto("?engine=mock#/neversynced");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  await pasteImage(page);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await expect(page.getByTestId("stale-edit-dialog")).toBeHidden();
});

test("a reachable remote never raises the dialog, and the round's own commit passes", async ({
  page,
}) => {
  // Same board, same base — but the transport is there, so a sync round runs
  // and lands its merged result through `commit(..., "preserve")`. Guarding
  // that would hold the very thing the dialog exists to start, and the board
  // would never finish loading.
  await page.goto(`?engine=mock&sync=fake#/${BOARD}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await pasteImage(page);
  await expect.poll(() => hasBase(page), { timeout: 15000 }).toBe(true);
  await expect.poll(() => storedNodes(page), { timeout: 15000 }).toBe(1);

  await page.reload();
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await pasteImage(page);
  await expect(page.getByTestId("board-node")).toHaveCount(2);
  await expect(page.getByTestId("stale-edit-dialog")).toBeHidden();
});
