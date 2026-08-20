import { expect, test, type Page } from "@playwright/test";

/**
 * The pass over every board, rather than the one that is open.
 *
 * Two holes with the same shape: connecting uploaded only the board you
 * happened to be looking at, and a board made on another device never appeared
 * here at all.
 */

const OPEN = "openboard";

/** Writes a board straight into the fake remote, as another device would. */
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

function remoteBoardIds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("canwas-fake-remote");
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
  );
}

/** Creates a board locally through the UI and returns its id. */
async function makeBoard(page: Page, name: string): Promise<string> {
  await page.getByTestId("board-menu").click();
  await page.getByTestId("menu-new-board").click();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.getByTestId("board-name").click();
  const field = page.getByTestId("board-name-input");
  await field.fill(name);
  await field.press("Enter");
  await expect(page.getByTestId("board-name")).toHaveText(name);
  return new URL(page.url()).hash.replace(/^#\//, "").split("-")[0];
}

test.beforeEach(async ({ page }) => {
  await page.goto(`?engine=mock&sync=fake#/${OPEN}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("every local board reaches the remote, not just the open one", async ({
  page,
}) => {
  // Made before ever connecting — no `sync=fake`, so there is no transport and
  // nothing is uploaded. This matters: a board that is merely *open* while a
  // transport exists gets pushed by `useSync`, which would let this test pass
  // without the pass existing at all.
  await page.goto(`?engine=mock#/${OPEN}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const first = await makeBoard(page, "Kitchen");
  const second = await makeBoard(page, "Garden");
  // (The board opened by `beforeEach` is already up there; these two are not.)
  const before = await remoteBoardIds(page);
  expect(before).not.toContain(first);
  expect(before).not.toContain(second);

  // Connecting is supposed to mean "back up my work", not "back up the thing I
  // am looking at".
  await page.goto(`?engine=mock&sync=fake#/${OPEN}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  await expect
    .poll(() => remoteBoardIds(page), { timeout: 15000 })
    .toEqual(expect.arrayContaining([first, second]));
});

test("a board from another device appears in the menu", async ({ page }) => {
  await putRemoteBoard(page, {
    id: "fromthephone",
    _version: 1,
    name: "From The Phone",
    nodes: [],
    tombstones: [],
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now() - 10_000,
  });

  // A reload is a fresh connection. (`goto` to the URL already showing is a
  // no-op under hash routing, which quietly makes a test of nothing.)
  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  // The menu is fed from local IndexedDB, so this only works if the pass wrote
  // the board to disk — not merely into an atom that a reload would forget.
  await page.getByTestId("board-menu").click();
  await expect(page.getByText("From The Phone")).toBeVisible({
    timeout: 15000,
  });

  await page.reload();
  await page.getByTestId("board-menu").click();
  await expect(page.getByText("From The Phone")).toBeVisible();
});

test("a board that has not moved is settled without a request", async ({
  page,
}) => {
  const quiet = await makeBoard(page, "Settled");
  await page.goto(`?engine=mock&sync=fake#/${OPEN}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await expect
    .poll(() => remoteBoardIds(page), { timeout: 15000 })
    .toContain(quiet);

  // Both sides and the base now agree. Rename the remote copy *without*
  // touching its `updatedAt` — a lie, and one only a fetch can discover. A
  // round would read it, resolve the tie in the later name's favour, and write
  // that name to disk here. A skip never looks.
  await page.evaluate(
    (boardId) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("canwas-fake-remote");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result
            .transaction("boards", "readwrite")
            .objectStore("boards");
          const read = store.get(boardId);
          read.onsuccess = () => {
            const write = store.put({ ...read.result, name: "ZZZ Touched" });
            write.onsuccess = () => resolve();
            write.onerror = () => reject(write.error);
          };
        };
      }),
    quiet,
  );

  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.waitForTimeout(2500);

  const localName = await page.evaluate(
    (boardId) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("canwas");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const read = open.result
            .transaction("boards", "readonly")
            .objectStore("boards")
            .get(boardId);
          read.onsuccess = () => resolve(read.result?.name ?? "");
          read.onerror = () => reject(read.error);
        };
      }),
    quiet,
  );
  // Untouched, because it was never read. Fifty boards that have not moved
  // cost fifty comparisons and no requests.
  expect(localName).toBe("Settled");
});
