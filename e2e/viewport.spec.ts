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

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/demo");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("drag pans the scene", async ({ page }) => {
  const before = await readTransform(page);
  const surface = await centerOf(page, "canvas-surface");

  await page.mouse.move(surface.x, surface.y);
  await page.mouse.down();
  await page.mouse.move(surface.x + 200, surface.y + 150, { steps: 10 });
  await page.mouse.up();

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
  await page.mouse.move(surface.x, surface.y);
  await page.mouse.down();
  await page.mouse.move(surface.x + 120, surface.y + 90, { steps: 5 });
  await page.mouse.up();

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
  await page.mouse.move(surface.x, surface.y);
  await page.mouse.down();
  await page.mouse.move(surface.x + 80, surface.y + 40, { steps: 3 });
  await page.mouse.up();

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
