import { expect, test, type Page } from "@playwright/test";

async function pasteImage(page: Page, width: number, height: number, tint = 0) {
  await page.evaluate(
    async ({ w, h, tint }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      context.fillStyle = `hsl(${tint}, 70%, 85%)`;
      context.fillRect(0, 0, w, h);
      context.fillStyle = "#0a0a0a";
      context.font = `bold ${Math.round(h / 4)}px sans-serif`;
      context.fillText(String(tint), w * 0.1, h * 0.6);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([blob!], `shot-${tint}.png`, { type: "image/png" }),
      );
      window.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { w: width, h: height, tint },
  );
}

async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

async function centreOf(locator: ReturnType<Page["getByTestId"]>) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The board's stored name, read straight from IndexedDB. */
function storedName(page: Page, boardId: string) {
  return page.evaluate(
    (id) =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open("canwas");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("boards")) {
            resolve(null);
            return;
          }
          const request = db
            .transaction("boards", "readonly")
            .objectStore("boards")
            .get(id);
          request.onsuccess = () => resolve(request.result?.name ?? null);
        };
      }),
    boardId,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/CanWas/#/board/demo");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("click selects, escape and empty-canvas click deselect", async ({
  page,
}) => {
  await pasteImage(page, 400, 300, 10);
  const node = page.getByTestId("board-node");

  await node.click();
  await expect(node).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("Escape");
  await expect(node).not.toHaveAttribute("data-selected", "true");

  await node.click();
  await expect(node).toHaveAttribute("data-selected", "true");
  const surface = (await page.getByTestId("canvas-surface").boundingBox())!;
  await page.mouse.click(surface.x + surface.width - 40, surface.y + 40);
  await expect(node).not.toHaveAttribute("data-selected", "true");
});

test("dragging a node moves it, and the move is one undo step", async ({
  page,
}) => {
  await pasteImage(page, 400, 300, 20);
  const node = page.getByTestId("board-node");
  const before = (await node.boundingBox())!;

  await dragBy(page, await centreOf(node), 120, 80);

  const after = (await node.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(120, 0);
  expect(after.y - before.y).toBeCloseTo(80, 0);

  // One drag is one entry, no matter how many pointermove events it produced.
  await page.keyboard.press("ControlOrMeta+z");
  const undone = (await node.boundingBox())!;
  expect(undone.x).toBeCloseTo(before.x, 0);
  expect(undone.y).toBeCloseTo(before.y, 0);

  await page.keyboard.press("ControlOrMeta+Shift+z");
  const redone = (await node.boundingBox())!;
  expect(redone.x).toBeCloseTo(after.x, 0);

  await page.screenshot({ path: "e2e/screenshots/board-selected.png" });
});

test("delete removes the selection and undo restores it", async ({ page }) => {
  await pasteImage(page, 300, 200, 30);
  const nodes = page.getByTestId("board-node");
  await nodes.click();
  await page.keyboard.press("Delete");
  await expect(nodes).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes).toHaveCount(1);
});

test("undo unwinds a paste, and a new action clears the redo branch", async ({
  page,
}) => {
  await pasteImage(page, 300, 200, 40);
  await pasteImage(page, 300, 200, 50);
  const nodes = page.getByTestId("board-node");
  await expect(nodes).toHaveCount(2);

  await page.getByTestId("undo").click();
  await expect(nodes).toHaveCount(1);
  await expect(page.getByTestId("redo")).toBeEnabled();

  // A fresh mutation must make the redo branch unreachable.
  await pasteImage(page, 120, 120, 60);
  await expect(nodes).toHaveCount(2);
  await expect(page.getByTestId("redo")).toBeDisabled();
});

test("resize is aspect-locked and undoable", async ({ page }) => {
  await pasteImage(page, 400, 200, 70);
  const node = page.getByTestId("board-node");
  await node.click();

  const before = (await node.boundingBox())!;
  const handle = page.getByTestId("resize-handle");
  await expect(handle).toBeVisible();

  const handleCentre = await centreOf(handle);
  await dragBy(page, handleCentre, 120, 0);

  const after = (await node.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width);
  // Aspect ratio is preserved, so the image is never distorted.
  expect(after.width / after.height).toBeCloseTo(
    before.width / before.height,
    1,
  );

  await page.keyboard.press("ControlOrMeta+z");
  const undone = (await node.boundingBox())!;
  expect(undone.width).toBeCloseTo(before.width, 0);
});

test("bracket keys reorder paint order", async ({ page }) => {
  await pasteImage(page, 300, 300, 80);
  await pasteImage(page, 300, 300, 90);
  const nodes = page.getByTestId("board-node");

  const idsBefore = await nodes.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-node-id")),
  );

  // The last node in DOM order paints on top; send it to the back.
  await nodes.last().click();
  await page.keyboard.press("[");

  const idsAfter = await nodes.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-node-id")),
  );
  expect(idsAfter[0]).toBe(idsBefore[1]);

  await page.keyboard.press("ControlOrMeta+z");
  const idsUndone = await nodes.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-node-id")),
  );
  expect(idsUndone).toEqual(idsBefore);
});

test("select all and multi-node move", async ({ page }) => {
  await pasteImage(page, 250, 250, 100);
  await pasteImage(page, 250, 250, 110);
  const nodes = page.getByTestId("board-node");
  await expect(nodes).toHaveCount(2);

  await page.keyboard.press("ControlOrMeta+a");
  await expect(nodes.first()).toHaveAttribute("data-selected", "true");
  await expect(nodes.last()).toHaveAttribute("data-selected", "true");

  const firstBefore = (await nodes.first().boundingBox())!;
  const secondBefore = (await nodes.last().boundingBox())!;
  await dragBy(page, await centreOf(nodes.last()), 90, 60);

  const firstAfter = (await nodes.first().boundingBox())!;
  const secondAfter = (await nodes.last().boundingBox())!;
  expect(firstAfter.x - firstBefore.x).toBeCloseTo(90, 0);
  expect(secondAfter.x - secondBefore.x).toBeCloseTo(90, 0);

  // Both nodes moved, but it is still a single undo step.
  await page.keyboard.press("ControlOrMeta+z");
  expect((await nodes.first().boundingBox())!.x).toBeCloseTo(firstBefore.x, 0);
  expect((await nodes.last().boundingBox())!.x).toBeCloseTo(secondBefore.x, 0);

  await page.screenshot({ path: "e2e/screenshots/board-multi.png" });
});

test("resize then drag keeps the new size, in memory and after reload", async ({
  page,
}) => {
  await pasteImage(page, 400, 200, 120);
  const node = page.getByTestId("board-node");
  await node.click();
  const original = (await node.boundingBox())!;

  const handle = (await page.getByTestId("resize-handle").boundingBox())!;
  await dragBy(
    page,
    { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
    120,
    60,
  );
  const resized = (await node.boundingBox())!;
  expect(resized.width).toBeGreaterThan(original.width + 50);

  await dragBy(page, await centreOf(node), 60, 40);
  const dragged = (await node.boundingBox())!;
  expect(dragged.width).toBeCloseTo(resized.width, 0);
  expect(dragged.height).toBeCloseTo(resized.height, 0);

  // The viewport save runs on a longer timer than the content save and used to
  // write a node list captured at hydration, silently undoing both edits.
  await page.waitForTimeout(1400);
  await page.reload();
  const restored = (await page.getByTestId("board-node").boundingBox())!;
  expect(restored.width).toBeCloseTo(dragged.width, 0);
  expect(restored.x).toBeCloseTo(dragged.x, 0);
});

test("a cancelled gesture aborts instead of committing, and unsticks", async ({
  page,
}) => {
  await pasteImage(page, 300, 300, 130);
  const node = page.getByTestId("board-node");
  await node.click();
  const before = (await node.boundingBox())!;

  // Start a drag, then have the browser take the pointer away mid-gesture.
  const centre = await centreOf(node);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 90, centre.y + 60, { steps: 4 });
  await page.evaluate(() => {
    window.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }),
    );
  });
  await page.mouse.up();

  // Cancel discards the gesture rather than committing a wrong rectangle.
  const afterCancel = (await node.boundingBox())!;
  expect(afterCancel.x).toBeCloseTo(before.x, 0);
  expect(afterCancel.y).toBeCloseTo(before.y, 0);

  // And the overlay is not left stuck: the next drag still works.
  await dragBy(page, await centreOf(node), 70, 50);
  const afterDrag = (await node.boundingBox())!;
  expect(afterDrag.x - before.x).toBeCloseTo(70, 0);
  expect(afterDrag.width).toBeCloseTo(before.width, 0);
});

test("the board is renamable, and the name persists", async ({ page }) => {
  await page.goto("/CanWas/#/board/rename-me");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  const name = page.getByTestId("board-name");
  await expect(name).toHaveText("rename-me");
  await page.screenshot({ path: "e2e/screenshots/chrome-idle.png" });

  await name.click();
  const input = page.getByTestId("board-name-input");
  await expect(input).toBeFocused();
  await page.screenshot({ path: "e2e/screenshots/chrome-editing.png" });

  await input.fill("Reference sheet");
  await input.press("Enter");
  await expect(name).toHaveText("Reference sheet");

  // The write is async, and a reload can abort a transaction still in flight.
  await expect
    .poll(() => storedName(page, "rename-me"))
    .toBe("Reference sheet");
  await page.reload();
  await expect(page.getByTestId("board-name")).toHaveText("Reference sheet");
});

test("escape abandons a rename, and an empty name is refused", async ({
  page,
}) => {
  await page.goto("/CanWas/#/board/keep-name");
  const name = page.getByTestId("board-name");
  await expect(name).toHaveText("keep-name");

  await name.click();
  await page.getByTestId("board-name-input").fill("discarded");
  await page.getByTestId("board-name-input").press("Escape");
  await expect(name).toHaveText("keep-name");

  await name.click();
  await page.getByTestId("board-name-input").fill("   ");
  await page.getByTestId("board-name-input").press("Enter");
  await expect(name).toHaveText("keep-name");
});

test("editing the name does not trigger board shortcuts", async ({ page }) => {
  await page.goto("/CanWas/#/board/shortcut-safe");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await pasteImage(page, 300, 200, 140);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  await page.getByTestId("board-name").click();
  const input = page.getByTestId("board-name-input");
  await input.fill("abc");
  // Backspace and Select All belong to the text field, not to the board.
  await input.press("Backspace");
  await input.press("ControlOrMeta+a");
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  await input.press("Enter");
  await expect(page.getByTestId("board-name")).toHaveText("ab");
});
