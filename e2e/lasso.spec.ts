import { expect, test, type Page } from "@playwright/test";

/** Two small images, dragged apart so a box can enclose either one alone. */
async function twoSpacedNodes(page: Page) {
  await pasteImage(page, 200, 150, 40);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await pasteImage(page, 200, 150, 200);
  await expect(page.getByTestId("board-node")).toHaveCount(2);

  const first = page.getByTestId("board-node").nth(0);
  const second = page.getByTestId("board-node").nth(1);
  await dragBy(page, await centreOf(second), 280, 140);
  await dragBy(page, await centreOf(first), -280, -140);
  return { first, second };
}

async function pasteImage(page: Page, width: number, height: number, tint = 0) {
  await page.evaluate(
    async ({ w, h, tint }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      context.fillStyle = `hsl(${tint}, 70%, 85%)`;
      context.fillRect(0, 0, w, h);
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

async function centreOf(locator: ReturnType<Page["getByTestId"]>) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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

/** Drags a selection box between two screen points, with a modifier held. */
async function lasso(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifier?: "Shift",
) {
  if (modifier) {
    await page.keyboard.down(modifier);
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (modifier) {
    await page.keyboard.up(modifier);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/demo");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a selection box takes every node it touches", async ({ page }) => {
  const { first, second } = await twoSpacedNodes(page);
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;

  // A box around the first node alone.
  await lasso(
    page,
    { x: a.x - 20, y: a.y - 20 },
    { x: a.x + a.width + 20, y: a.y + a.height + 20 },
  );
  await expect(first).toHaveAttribute("data-selected", "true");
  await expect(second).not.toHaveAttribute("data-selected", "true");

  // Widened to touch the second as well — contact is enough, the box need not
  // contain it.
  await lasso(page, { x: a.x - 20, y: a.y - 20 }, { x: b.x + 10, y: b.y + 10 });
  await expect(first).toHaveAttribute("data-selected", "true");
  await expect(second).toHaveAttribute("data-selected", "true");

  await page.screenshot({ path: "e2e/screenshots/canvas-lassoed.png" });
});

test("shift adds to the selection instead of replacing it", async ({
  page,
}) => {
  const { first, second } = await twoSpacedNodes(page);
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;

  await lasso(
    page,
    { x: a.x - 20, y: a.y - 20 },
    { x: a.x + a.width + 20, y: a.y + a.height + 20 },
  );
  await expect(first).toHaveAttribute("data-selected", "true");

  await lasso(
    page,
    { x: b.x - 20, y: b.y - 20 },
    { x: b.x + b.width + 20, y: b.y + b.height + 20 },
    "Shift",
  );
  // Without the modifier this second box would have dropped the first node.
  await expect(first).toHaveAttribute("data-selected", "true");
  await expect(second).toHaveAttribute("data-selected", "true");
});

test("a multi-selection moves together and deletes as one step", async ({
  page,
}) => {
  const { first, second } = await twoSpacedNodes(page);
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;

  await lasso(
    page,
    { x: a.x - 20, y: a.y - 20 },
    { x: b.x + b.width + 20, y: b.y + b.height + 20 },
  );
  await expect(first).toHaveAttribute("data-selected", "true");
  await expect(second).toHaveAttribute("data-selected", "true");

  // Dragging one member of the selection drags all of it.
  await dragBy(page, await centreOf(first), 60, 40);
  const movedA = (await first.boundingBox())!;
  const movedB = (await second.boundingBox())!;
  expect(movedA.x - a.x).toBeCloseTo(60, 0);
  expect(movedB.x - b.x).toBeCloseTo(60, 0);
  expect(movedB.y - b.y).toBeCloseTo(40, 0);

  // And both come back with one undo, so the move was a single change.
  await page.getByTestId("undo").click();
  expect((await first.boundingBox())!.x).toBeCloseTo(a.x, 0);
  expect((await second.boundingBox())!.x).toBeCloseTo(b.x, 0);

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("board-node")).toHaveCount(0);
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("board-node")).toHaveCount(2);
});

test("a click on empty canvas is not a selection box", async ({ page }) => {
  const { first } = await twoSpacedNodes(page);
  await first.click();
  await expect(first).toHaveAttribute("data-selected", "true");

  const surface = (await page.getByTestId("canvas-surface").boundingBox())!;
  const empty = {
    x: surface.x + surface.width - 40,
    y: surface.y + surface.height / 2,
  };
  // A press that drifts a pixel is still a click: below the threshold no box
  // appears at all.
  await lasso(page, empty, { x: empty.x + 1, y: empty.y + 1 });
  await expect(page.getByTestId("lasso")).toHaveCount(0);
  await expect(first).not.toHaveAttribute("data-selected", "true");
});
