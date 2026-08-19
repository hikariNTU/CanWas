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
  await page.mouse.click(surface.x + 30, surface.y + 30);
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
