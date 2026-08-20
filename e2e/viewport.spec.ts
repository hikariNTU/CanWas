import { expect, test, type Page } from "@playwright/test";

/** Reads the scene's live CSS transform as { scale, tx, ty }. */
async function readTransform(page: Page) {
  return page.getByTestId("canvas-scene").evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { scale: matrix.a, tx: matrix.e, ty: matrix.f };
  });
}

async function centerOf(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) {
    throw new Error(`${testId} has no bounding box`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Pans by dragging with the middle button.
 *
 * Left-drag on empty canvas draws a selection box, so it no longer pans (D54).
 * Middle-drag and space+drag are what pan with a mouse now.
 */
async function panDrag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up({ button: "middle" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/demo");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("middle-drag pans the scene", async ({ page }) => {
  const before = await readTransform(page);
  const surface = await centerOf(page, "canvas-surface");

  await panDrag(page, surface, 200, 150);

  const after = await readTransform(page);
  expect(after.tx - before.tx).toBeCloseTo(200, 0);
  expect(after.ty - before.ty).toBeCloseTo(150, 0);
  // Panning must never touch zoom.
  expect(after.scale).toBeCloseTo(before.scale, 5);

  await page.screenshot({ path: "e2e/screenshots/canvas-panned.png" });
});

test("ctrl+wheel zoom keeps the point under the cursor fixed", async ({
  page,
}) => {
  // Pan first so the world origin sits somewhere useful to anchor on.
  const surface = await centerOf(page, "canvas-surface");
  await panDrag(page, surface, 120, 90);

  const anchor = await centerOf(page, "world-origin");
  const before = await readTransform(page);

  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");

  const after = await readTransform(page);
  expect(after.scale).toBeGreaterThan(before.scale);

  // The whole point of anchored zoom: the world point under the cursor does
  // not move on screen.
  const anchorAfter = await centerOf(page, "world-origin");
  expect(anchorAfter.x).toBeCloseTo(anchor.x, 0);
  expect(anchorAfter.y).toBeCloseTo(anchor.y, 0);

  await page.screenshot({ path: "e2e/screenshots/canvas-zoomed.png" });
});

test("zoom controls and reset", async ({ page }) => {
  const reset = page.getByTestId("zoom-reset");
  await expect(reset).toHaveText("100%");

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(reset).toHaveText("120%");

  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(reset).toHaveText("100%");

  // Move away from identity, then confirm reset restores it exactly.
  await page.getByRole("button", { name: "Zoom in" }).click();
  const surface = await centerOf(page, "canvas-surface");
  await panDrag(page, surface, 80, 40);

  await reset.click();
  await expect(reset).toHaveText("100%");
  expect(await readTransform(page)).toEqual({ scale: 1, tx: 0, ty: 0 });
});

test("zoom is clamped at both ends", async ({ page }) => {
  const reset = page.getByTestId("zoom-reset");
  const surface = await centerOf(page, "canvas-surface");
  await page.mouse.move(surface.x, surface.y);

  // One event cannot cross the range: the delta is clamped so a single mouse
  // notch is a sane step rather than a jump to the limit.
  await page.keyboard.down("Control");
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, -120);
  }
  await page.keyboard.up("Control");
  await expect(reset).toHaveText("800%");

  await page.keyboard.down("Control");
  for (let i = 0; i < 80; i++) {
    await page.mouse.wheel(0, 120);
  }
  await page.keyboard.up("Control");
  await expect(reset).toHaveText("10%");
});

test("content stays visible below the grid's fade threshold", async ({
  page,
}) => {
  // The grid fades out once its dots crowd together, which happens at 25%.
  // It used to be painted onto the surface, so fading it faded every node
  // with it: the board went blank at exactly the zoom where you most want
  // the overview.
  const surface = await centerOf(page, "canvas-surface");
  await page.mouse.dblclick(surface.x, surface.y);
  await page.keyboard.type("Still here");
  await page.mouse.move(surface.x, surface.y);
  await page.keyboard.press("Escape");

  const node = page.getByTestId("board-node");
  await expect(node).toBeVisible();

  await page.keyboard.down("Control");
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 120);
  }
  await page.keyboard.up("Control");

  const { scale } = await readTransform(page);
  expect(scale).toBeLessThan(0.25);

  await expect(page.getByTestId("canvas-grid")).toHaveCSS("opacity", "0");
  await expect(page.getByTestId("canvas-surface")).toHaveCSS("opacity", "1");
  await expect(node).toBeVisible();
  const box = await node.boundingBox();
  expect(box?.width).toBeGreaterThan(0);

  await page.screenshot({ path: "e2e/screenshots/canvas-zoomed-out.png" });
});

test("space+drag pans, and left-drag alone does not", async ({ page }) => {
  const surface = await centerOf(page, "canvas-surface");
  const before = await readTransform(page);

  // Without the pan key, a left drag on empty canvas is a selection box.
  await page.mouse.move(surface.x, surface.y);
  await page.mouse.down();
  await page.mouse.move(surface.x + 60, surface.y + 40, { steps: 4 });
  await expect(page.getByTestId("lasso")).toBeVisible();
  await page.mouse.up();
  expect(await readTransform(page)).toEqual(before);

  await page.keyboard.down("Space");
  await page.mouse.move(surface.x, surface.y);
  await page.mouse.down();
  await page.mouse.move(surface.x + 60, surface.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");

  const after = await readTransform(page);
  expect(after.tx - before.tx).toBeCloseTo(60, 0);
  expect(after.ty - before.ty).toBeCloseTo(40, 0);
});

test("the board follows the pointer before the gesture ends", async ({
  page,
}) => {
  const start = await centerOf(page, "canvas-surface");
  const before = await readTransform(page);

  // Held down deliberately: a pan paints the scene itself and tells the store
  // nothing until it ends (D77), so the interesting moment is mid-gesture.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(start.x + 120, start.y + 60, { steps: 6 });
  // One frame for the coalesced paint.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve)),
  );

  const during = await readTransform(page);
  expect(during.tx).toBeCloseTo(before.tx + 120, 0);
  expect(during.ty).toBeCloseTo(before.ty + 60, 0);

  // A render mid-gesture must not drag the board back to where the store still
  // thinks it is: pressing Escape re-renders through the selection.
  await page.keyboard.press("Escape");
  const after = await readTransform(page);
  expect(after.tx).toBeCloseTo(during.tx, 0);

  await page.mouse.up({ button: "middle" });
  const committed = await readTransform(page);
  expect(committed.tx).toBeCloseTo(during.tx, 0);
  expect(committed.ty).toBeCloseTo(during.ty, 0);
});
