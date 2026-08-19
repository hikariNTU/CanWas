import { expect, test, type Page } from "@playwright/test";

/**
 * Sync against the fake remote (`?sync=fake`) — a second IndexedDB database
 * standing in for Drive.
 *
 * A second browser context cannot share it, so the other device is played by
 * writing into that database directly. That is honest about what is being
 * tested: the loop and the merge, running the same code path Drive will use,
 * with the network swapped out.
 */

const BOARD = "syncme";

async function pasteImage(page: Page, tint = 0) {
  await page.evaluate(async (t) => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 150;
    const context = canvas.getContext("2d")!;
    context.fillStyle = `hsl(${t}, 70%, 80%)`;
    context.fillRect(0, 0, 200, 150);
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
  }, tint);
}

/** Reads a board record out of the fake remote's database. */
function remoteBoard(page: Page, id: string) {
  return page.evaluate(
    (boardId) =>
      new Promise<{ nodes: { id: string }[]; name: string } | null>(
        (resolve) => {
          const open = indexedDB.open("canwas-fake-remote");
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("boards")) {
              resolve(null);
              return;
            }
            const request = db
              .transaction("boards", "readonly")
              .objectStore("boards")
              .get(boardId);
            request.onsuccess = () => resolve(request.result ?? null);
          };
        },
      ),
    id,
  );
}

function remoteAssetCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("canwas-fake-remote");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("assets")) {
            resolve(0);
            return;
          }
          const request = db
            .transaction("assets", "readonly")
            .objectStore("assets")
            .count();
          request.onsuccess = () => resolve(request.result);
        };
      }),
  );
}

/** Plays the other device: adds a node to the remote board behind the app's back. */
function addRemoteNode(page: Page, id: string, node: Record<string, unknown>) {
  return page.evaluate(
    ({ boardId, added }) =>
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
            board.nodes.push(added);
            board.updatedAt = Date.now();
            const write = store.put(board);
            write.onsuccess = () => resolve();
            write.onerror = () => reject(write.error);
          };
        };
      }),
    { boardId: id, added: node },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(`?engine=mock&sync=fake#/${BOARD}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a local board reaches the remote, images and all", async ({ page }) => {
  await pasteImage(page, 20);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  await expect
    .poll(() => remoteBoard(page, BOARD), { timeout: 15000 })
    .not.toBeNull();
  await expect
    .poll(async () => (await remoteBoard(page, BOARD))?.nodes.length, {
      timeout: 15000,
    })
    .toBe(1);

  // The bytes go too, or another device renders a board full of holes.
  await expect.poll(() => remoteAssetCount(page), { timeout: 15000 }).toBe(1);

  await expect(page.getByTestId("sync-button")).toHaveAttribute(
    "data-sync-state",
    "idle",
  );
});

test("the sync button syncs on demand", async ({ page }) => {
  await pasteImage(page, 80);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  const button = page.getByTestId("sync-button");
  await expect(button).toHaveAttribute("data-sync-state", "idle");

  // Another device adds a node. Pressing the button is how you find out
  // without reloading or waiting for the quiet timer.
  await addRemoteNode(page, BOARD, {
    id: "pressed",
    kind: "text",
    order: "a9",
    updatedAt: Date.now(),
    x: 300,
    y: 300,
    w: 200,
    h: 24,
    text: "arrived on demand",
    fontSize: 16,
  });

  await button.click();
  await expect(page.locator('[data-node-id="pressed"]')).toBeVisible({
    timeout: 15000,
  });
});

test("a node added by another device arrives, without losing the local one", async ({
  page,
}) => {
  await pasteImage(page, 40);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await expect
    .poll(async () => (await remoteBoard(page, BOARD))?.nodes.length, {
      timeout: 15000,
    })
    .toBe(1);

  await addRemoteNode(page, BOARD, {
    id: "fromelsewhere",
    kind: "text",
    order: "a5",
    updatedAt: Date.now(),
    x: 400,
    y: 400,
    w: 200,
    h: 24,
    text: "typed on the other device",
    fontSize: 16,
  });

  // A reload pulls. Both nodes survive — the case that makes whole-board
  // last-writer-wins wrong.
  await page.reload();
  await expect(page.getByTestId("board-node")).toHaveCount(2, {
    timeout: 15000,
  });
  await expect(page.locator('[data-node-id="fromelsewhere"]')).toBeVisible();
});

test("a locally deleted node is not pushed back by the remote copy", async ({
  page,
}) => {
  await pasteImage(page, 60);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);
  await expect
    .poll(async () => (await remoteBoard(page, BOARD))?.nodes.length, {
      timeout: 15000,
    })
    .toBe(1);

  await node.click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("board-node")).toHaveCount(0);

  // The remote still holds it, and would hand it straight back without a
  // tombstone to say the deletion was deliberate.
  await expect
    .poll(async () => (await remoteBoard(page, BOARD))?.nodes.length, {
      timeout: 15000,
    })
    .toBe(0);

  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("board-node")).toHaveCount(0);
});
