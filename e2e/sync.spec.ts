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
    context.fillStyle = `hsl(${t}, 70%, 92%)`;
    context.fillRect(0, 0, 200, 150);
    // Real ink, so the recognizer has something to find. A flat rectangle is
    // recognized as nothing at all, which is correct and proves nothing.
    context.fillStyle = "#111111";
    context.font = "bold 26px sans-serif";
    context.fillText("read me", 16, 60);
    context.fillText("please", 16, 110);
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

test("a node whose image has not arrived shows a placeholder, not a hole", async ({
  page,
}) => {
  await pasteImage(page, 80);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  // Another device adds a node pointing at bytes nobody here has. The board
  // travels as JSON and the images follow separately, so this is the ordinary
  // state between the two writes — not a corruption.
  await addRemoteNode(page, BOARD, {
    id: "orphan",
    kind: "image",
    order: "a9",
    updatedAt: Date.now(),
    x: 400,
    y: 400,
    w: 200,
    h: 150,
    assetId: "0000000000000000000000000000000000000000000000000000000000000000",
  });
  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-now").click();

  const orphan = page.locator('[data-node-id="orphan"]');
  await expect(orphan).toBeVisible();
  // Visible, and visibly a picture that is not here. Rendering nothing left a
  // node that could be selected, dragged and deleted while invisible.
  await expect(orphan.getByTestId("missing-asset")).toBeVisible();
  const box = (await orphan.boundingBox())!;
  expect(box.width).toBeCloseTo(200, 0);
  expect(box.height).toBeCloseTo(150, 0);
});

/** Reads or writes the fake remote's recognition store. */
function remoteText(page: Page, id: string) {
  return page.evaluate(
    (key) =>
      new Promise<{ engine: string; words: unknown[] } | null>(
        (resolve, reject) => {
          const open = indexedDB.open("canwas-fake-remote");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const read = open.result
              .transaction("text", "readonly")
              .objectStore("text")
              .get(key);
            read.onsuccess = () => resolve(read.result ?? null);
            read.onerror = () => reject(read.error);
          };
        },
      ),
    id,
  );
}

function putRemoteText(
  page: Page,
  id: string,
  record: Record<string, unknown>,
) {
  return page.evaluate(
    ({ key, value }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("canwas-fake-remote");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const write = open.result
            .transaction("text", "readwrite")
            .objectStore("text")
            .put({ id: key, ...value });
          write.onsuccess = () => resolve();
          write.onerror = () => reject(write.error);
        };
      }),
    { key: id, value: record },
  );
}

/**
 * The asset id of the only node on the board — the hash of its bytes.
 *
 * Waits for the push rather than assuming it: the board record appears in the
 * remote before its nodes do, so reading it too early finds an empty one.
 */
async function onlyAssetId(page: Page): Promise<string> {
  await expect
    .poll(async () => (await remoteBoard(page, BOARD))?.nodes.length, {
      timeout: 15000,
    })
    .toBe(1);
  const board = await remoteBoard(page, BOARD);
  return (board!.nodes[0] as unknown as { assetId: string }).assetId;
}

test("a reading is uploaded once, and travels with the image", async ({
  page,
}) => {
  await pasteImage(page, 40);
  // Recognition is what makes the board useful and what costs 21 MB of weights
  // plus real seconds to produce. It depends on nothing but the bytes.
  await expect(page.getByTestId("board-node")).toHaveAttribute(
    "data-ocr-status",
    "done",
  );

  const assetId = await onlyAssetId(page);

  await expect
    .poll(() => remoteText(page, assetId), { timeout: 15000 })
    .not.toBeNull();
  const stored = (await remoteText(page, assetId))!;
  expect(stored.words.length).toBeGreaterThan(0);
  // Stamped, so a future format can be told apart from this one rather than
  // half-read by a device that has not been updated.
  expect(stored).toHaveProperty("_version", 1);
  // Which recognizer produced it, because a mock reading is invented text.
  expect(stored.engine).toBe("mock");
});

/** Writes image bytes straight into the fake remote's asset store. */
function putRemoteAsset(page: Page, id: string) {
  return page.evaluate(
    (key) =>
      new Promise<void>((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 120;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, 240, 120);
        context.fillStyle = "#111111";
        context.font = "bold 28px sans-serif";
        // Real ink, so that recognizing this locally would find several words
        // — which is how the test can tell adoption from recomputation.
        context.fillText("alpha beta", 12, 45);
        context.fillText("gamma", 12, 95);
        canvas.toBlob((blob) => {
          const open = indexedDB.open("canwas-fake-remote");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const write = open.result
              .transaction("assets", "readwrite")
              .objectStore("assets")
              .put({ id: key, blob: blob!, extension: "png" });
            write.onsuccess = () => resolve();
            write.onerror = () => reject(write.error);
          };
        }, "image/png");
      }),
    id,
  );
}

test("an image arrives already read, instead of being read again", async ({
  page,
}) => {
  await pasteImage(page, 60);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await onlyAssetId(page);

  // Another device has an image this one has never seen, and has already paid
  // to read it. Both the bytes and the reading are waiting.
  const remoteId = "remoteassetremoteassetremoteasset";
  await putRemoteAsset(page, remoteId);
  await putRemoteText(page, remoteId, {
    _version: 1,
    engine: "mock",
    words: [
      { text: "fromelsewhere", x0: 0, y0: 0, x1: 50, y1: 20, confidence: 0.9 },
    ],
  });
  await addRemoteNode(page, BOARD, {
    id: "carried",
    kind: "image",
    order: "a9",
    updatedAt: Date.now(),
    x: 400,
    y: 400,
    w: 240,
    h: 120,
    assetId: remoteId,
  });

  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-now").click();

  const carried = page.locator('[data-node-id="carried"]');
  await expect(carried).toHaveAttribute("data-ocr-status", "done", {
    timeout: 15000,
  });
  // Exactly the reading that came down. Recognizing those pixels here would
  // have found the three words drawn on them, so this also proves the local
  // pipeline never touched it: the reading arrives before the image does, and
  // an asset stored already-read never enters the queue.
  await expect(carried).toHaveAttribute("data-ocr-words", "1");
});

test("a reading from a different recognizer is refused", async ({ page }) => {
  await pasteImage(page, 80);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await onlyAssetId(page);

  const remoteId = "wrongenginewrongenginewrongengine";
  await putRemoteAsset(page, remoteId);
  // The mock invents its strings. Handing them to a build that would take them
  // for a real reading is the one way this feature can quietly ruin a board,
  // and the same is true in reverse.
  await putRemoteText(page, remoteId, {
    _version: 1,
    engine: "paddle",
    words: Array.from({ length: 99 }, () => ({
      text: "wrong",
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 1,
      confidence: 1,
    })),
  });
  await addRemoteNode(page, BOARD, {
    id: "refused",
    kind: "image",
    order: "a9",
    updatedAt: Date.now(),
    x: 400,
    y: 400,
    w: 240,
    h: 120,
    assetId: remoteId,
  });

  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-now").click();

  const refused = page.locator('[data-node-id="refused"]');
  await expect(refused).toHaveAttribute("data-ocr-status", "done", {
    timeout: 15000,
  });
  // Read here rather than taken from the remote: this build's recognizer finds
  // the words actually drawn on those pixels, which is not 99.
  await expect(refused).not.toHaveAttribute("data-ocr-words", "99");
});

test("a document from a newer version is refused, loudly", async ({ page }) => {
  await pasteImage(page, 100);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await onlyAssetId(page);

  // A device running a later build wrote this. Reading it with today's code
  // would half-succeed — keep the fields it knows, drop the rest — and the
  // write-back would destroy the evidence.
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
            const write = store.put({ ...read.result, _version: 99 });
            write.onsuccess = () => resolve();
            write.onerror = () => reject(write.error);
          };
        };
      }),
    BOARD,
  );

  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-now").click();

  const button = page.getByTestId("sync-button");
  await expect(button).toHaveAttribute("data-sync-state", "failed");
  // Colour, not a glyph to be read: a board is looked at, not inspected.
  await expect(page.getByTestId("sync-error-dot")).toBeVisible();
  // And the reason is in reach, rather than in the console.
  await expect(page.getByTestId("sync-state")).toContainText("newer version");

  // Refusing to read is also refusing to overwrite. The board that could not
  // be understood is still there, exactly as its author left it.
  const remote = await remoteBoard(page, BOARD);
  expect(remote).toHaveProperty("_version", 99);
});

test("opening someone else's board by id keeps its name", async ({ page }) => {
  // A link to a board this device has never seen. The id is all the URL
  // carries, so the board is materialised locally and filled in by the round
  // that follows.
  const shared = "sharedboardfromanotherdevice";
  await page.evaluate(
    (board) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("canwas-fake-remote");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const write = open.result
            .transaction("boards", "readwrite")
            .objectStore("boards")
            .put(board);
          write.onsuccess = () => resolve();
          write.onerror = () => reject(write.error);
        };
      }),
    {
      id: shared,
      _version: 1,
      name: "Research Notes",
      nodes: [
        {
          id: "theirs",
          kind: "text",
          order: "a1",
          updatedAt: Date.now() - 60_000,
          x: 100,
          y: 100,
          w: 200,
          h: 60,
          text: "written elsewhere",
          fontSize: 16,
        },
      ],
      tombstones: [],
      createdAt: Date.now() - 600_000,
      updatedAt: Date.now() - 60_000,
    },
  );

  await page.goto(`?engine=mock&sync=fake#/${shared}`);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  // The content arrives: an empty local side against no base is a union, not a
  // deletion.
  await expect(page.locator('[data-node-id="theirs"]')).toBeVisible({
    timeout: 15000,
  });

  // And the name survives. A placeholder has never been edited, so it has no
  // business winning a last-writer-wins comparison against the device that
  // actually named the board — least of all with the raw id for a name.
  await expect(page.getByTestId("board-name")).toHaveText("Research Notes");
  await expect
    .poll(async () => (await remoteBoard(page, shared))?.name, {
      timeout: 15000,
    })
    .toBe("Research Notes");
});

test("a rename on another device arrives here", async ({ page }) => {
  await pasteImage(page, 140);
  await onlyAssetId(page);

  // The other device renamed the board a minute ago. This one has not touched
  // it since, so there is nothing to disagree about.
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
            const write = store.put({
              ...read.result,
              name: "Renamed Elsewhere",
              updatedAt: Date.now() + 60_000,
            });
            write.onsuccess = () => resolve();
            write.onerror = () => reject(write.error);
          };
        };
      }),
    BOARD,
  );

  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-now").click();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("board-name")).toHaveText("Renamed Elsewhere", {
    timeout: 15000,
  });
  // And it outlives a reload, rather than living only in the atom.
  await page.reload();
  await expect(page.getByTestId("board-name")).toHaveText("Renamed Elsewhere");
});
