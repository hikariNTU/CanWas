import { expect, test, type Page } from "@playwright/test";

/**
 * Deleting a board while sync is connected (D66).
 *
 * A board removed from disk came straight back. The reconcile pass walks the
 * union of both sides, finds a board the remote has and this device does not,
 * and cannot tell "deleted here" from "never seen here" — so it downloads it
 * again on the next round. With Drive connected, deleting a board was not
 * something the app could do.
 *
 * The other device is played by writing into the fake remote's database
 * directly, exactly as `sync.spec.ts` does.
 */

const BOARD = "graveboard";

function record(page: Page, database: string, id: string) {
  return page.evaluate(
    ([name, boardId]) =>
      new Promise<{
        name: string;
        nodes: unknown[];
        updatedAt: number;
        deletedAt?: number;
      } | null>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("boards")) {
            resolve(null);
            return;
          }
          const read = db
            .transaction("boards", "readonly")
            .objectStore("boards")
            .get(boardId);
          read.onsuccess = () => resolve(read.result ?? null);
          read.onerror = () => reject(read.error);
        };
      }),
    [database, id] as const,
  );
}

const local = (page: Page, id: string) => record(page, "canwas", id);
const remote = (page: Page, id: string) =>
  record(page, "canwas-fake-remote", id);

async function addTextNode(page: Page, text: string) {
  await page.evaluate((body) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", body);
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

async function deleteCurrentBoard(page: Page) {
  await page.getByTestId("board-menu").click();
  await page.getByTestId("menu-delete-board").click();
  await page.getByTestId("confirm-delete").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto(`?engine=mock&sync=fake#/${BOARD}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a deleted board stays deleted, and the remote is told", async ({
  page,
}) => {
  await addTextNode(page, "work worth losing");
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  // It has to reach the remote first, or the deletion has nothing to undo and
  // the test passes for the wrong reason.
  await expect
    .poll(() => remote(page, BOARD), { timeout: 15000 })
    .not.toBeNull();

  await deleteCurrentBoard(page);
  // Off the board and onto another one.
  await expect.poll(() => page.url()).not.toContain(BOARD);

  // The record survives locally, carrying its marker. That is the whole
  // mechanism: a board dropped from disk is indistinguishable from one this
  // device has never heard of.
  // Polled, not read once: the board's own debounced save is very likely still
  // in flight at this point, and the property under test is that the grave
  // survives it — so the assertion has to be made after that save has landed,
  // not before it.
  await page.waitForTimeout(3000);
  const buried = await local(page, BOARD);
  expect(buried).not.toBeNull();
  expect(buried!.deletedAt).toBeGreaterThan(0);
  expect(buried!.deletedAt).toBeGreaterThanOrEqual(buried!.updatedAt);

  // And the deletion travels, so the other device buries it too rather than
  // handing it back.
  await expect
    .poll(async () => (await remote(page, BOARD))?.deletedAt, {
      timeout: 15000,
    })
    .toBeGreaterThan(0);

  // The reason this is worth a test: a reload runs the reconcile pass, which
  // is what used to resurrect it.
  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId("board-menu").click();
  await expect(
    page.getByTestId("menu-board-item").filter({ hasText: BOARD }),
  ).toHaveCount(0);
  expect((await local(page, BOARD))!.deletedAt).toBeGreaterThan(0);
});

test("a board deleted on another device disappears here", async ({ page }) => {
  await addTextNode(page, "deleted elsewhere");
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await expect
    .poll(() => remote(page, BOARD), { timeout: 15000 })
    .not.toBeNull();

  // Leave the board, so the reconcile pass is allowed to touch it: the open
  // board belongs to `useSync` and this pass skips it by design.
  await page.getByTestId("board-menu").click();
  await page.getByTestId("menu-new-board").click();
  await expect.poll(() => page.url()).not.toContain(BOARD);

  // The other device deletes it.
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
            const board = read.result;
            const now = Date.now();
            board.updatedAt = now;
            board.deletedAt = now;
            const write = store.put(board);
            write.onsuccess = () => resolve();
            write.onerror = () => reject(write.error);
          };
        };
      }),
    BOARD,
  );

  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  await expect
    .poll(async () => (await local(page, BOARD))?.deletedAt, {
      timeout: 15000,
    })
    .toBeGreaterThan(0);

  await page.getByTestId("board-menu").click();
  // The menu has to have something in it first. `not.toHaveCount(0)` on a
  // filtered locator is satisfied by an empty menu, a menu that has not
  // finished loading, and a menu that is genuinely right — and only the third
  // is what this test is about.
  await expect(page.getByTestId("menu-board-item")).not.toHaveCount(0);
  await expect(
    page.getByTestId("menu-board-item").filter({ hasText: BOARD }),
  ).toHaveCount(0);
});
