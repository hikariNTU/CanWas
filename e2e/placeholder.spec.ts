import { expect, test, type Page } from "@playwright/test";

import { pasteTextImage } from "./support";

/**
 * The board the app makes for itself, and what it costs the account.
 *
 * Landing with no boards creates an empty one, so the first thing a new device
 * did after connecting was upload it. Three machines, three empty "Untitled"
 * boards nobody asked for (D79).
 */

function idsIn(page: Page, database: string): Promise<string[]> {
  return page.evaluate(
    (name) =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("boards")) {
            resolve([]);
            return;
          }
          const keys = db
            .transaction("boards", "readonly")
            .objectStore("boards")
            .getAllKeys();
          keys.onsuccess = () => resolve(keys.result.map(String));
          keys.onerror = () => reject(keys.error);
        };
      }),
    database,
  );
}

const remoteBoardIds = (page: Page) => idsIn(page, "canwas-fake-remote");
const localBoardIds = (page: Page) => idsIn(page, "canwas");

function putRemoteBoard(
  page: Page,
  board: Record<string, unknown>,
): Promise<void> {
  return page.evaluate(
    (record) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("canwas-fake-remote");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const write = open.result
            .transaction("boards", "readwrite")
            .objectStore("boards")
            .put(record);
          write.onsuccess = () => resolve();
          write.onerror = () => reject(write.error);
        };
      }),
    board,
  );
}

/** The id in the URL — what the landing redirect decided to open. */
function openBoardId(page: Page): string {
  return new URL(page.url()).hash.replace(/^#\//, "").split("-")[0];
}

/**
 * Lands on `/` rather than on an id: a deep link materialises a board stamped
 * `updatedAt: 0`, which is a board this device has been *told about* and must
 * still sync. Only the landing board is a placeholder.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock&sync=fake");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("the board the app made for itself stays on this device", async ({
  page,
}) => {
  const placeholder = openBoardId(page);
  expect(placeholder).not.toBe("");
  expect(await localBoardIds(page)).toContain(placeholder);

  // Long enough for both upload paths: the open board pushes once edits go
  // quiet (2500ms), and the reconcile pass over every other board has already
  // run on connect.
  await page.waitForTimeout(4000);
  expect(await remoteBoardIds(page)).not.toContain(placeholder);
});

test("one image is enough to make it a real board", async ({ page }) => {
  const placeholder = openBoardId(page);
  await pasteTextImage(page, ["Receipt", "Total 480"]);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  // The guard has to release on the first edit, or the board that matters
  // most — the one you started on — is the one that never backs up.
  await expect
    .poll(() => remoteBoardIds(page), { timeout: 15000 })
    .toContain(placeholder);
});

test("naming an empty board is enough to make it a real board", async ({
  page,
}) => {
  const placeholder = openBoardId(page);
  await page.getByTestId("board-name").click();
  const field = page.getByTestId("board-name-input");
  await field.fill("Groceries");
  await field.press("Enter");
  await expect(page.getByTestId("board-name")).toHaveText("Groceries");

  // Nothing is on it, and it is still not a placeholder: naming a board is
  // something you can only do on purpose.
  await expect
    .poll(() => remoteBoardIds(page), { timeout: 15000 })
    .toContain(placeholder);
});

test("real boards arriving take the placeholder's place", async ({ page }) => {
  const placeholder = openBoardId(page);
  await putRemoteBoard(page, {
    id: "fromthelaptop",
    _version: 1,
    name: "From The Laptop",
    nodes: [],
    tombstones: [],
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now() - 10_000,
  });

  // A reload is a fresh connection, which is when the pass over every board
  // runs. This is the moment a new device meets an account that already has
  // work in it.
  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  // The screen steps off the empty board rather than leaving someone looking
  // at a blank canvas with their boards hidden in a menu.
  await expect
    .poll(() => openBoardId(page), { timeout: 15000 })
    .toBe("fromthelaptop");
  await expect(page.getByTestId("board-name")).toHaveText("From The Laptop");

  // Deleted outright, not buried: the remote never had it, so there is nothing
  // to tell anyone about — and a grave would be pushed up as a deletion of a
  // board that never existed.
  await expect
    .poll(() => localBoardIds(page), { timeout: 15000 })
    .not.toContain(placeholder);
  expect(await remoteBoardIds(page)).toEqual(["fromthelaptop"]);
});

test("a board with work on it is never taken away", async ({ page }) => {
  const mine = openBoardId(page);
  await pasteTextImage(page, ["Do not lose this"]);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  // Waited for rather than assumed: the local save is debounced, and a reload
  // inside that window loses the paste for reasons that have nothing to do
  // with placeholders.
  await expect
    .poll(() => remoteBoardIds(page), { timeout: 15000 })
    .toContain(mine);
  await putRemoteBoard(page, {
    id: "fromthelaptop",
    _version: 1,
    name: "From The Laptop",
    nodes: [],
    tombstones: [],
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now() - 10_000,
  });

  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  // The arrival lands, and the board on screen is not a placeholder, so it
  // stays — content, id and all.
  await expect
    .poll(() => localBoardIds(page), { timeout: 15000 })
    .toEqual(expect.arrayContaining(["fromthelaptop", mine]));
  expect(openBoardId(page)).toBe(mine);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
});
