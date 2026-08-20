import { expect, test, type Page } from "@playwright/test";

/**
 * How the chrome answers a pointer.
 *
 * Both halves are set far from where they are seen — the cursor in one CSS
 * rule in `src/index.css`, the hover tint in a utility repeated across a dozen
 * class lists — so a control added later inherits neither by accident. This is
 * the file that notices.
 */

/** Every floating control a fresh board shows, by the id it is found with. */
const CORNER = [
  "board-menu",
  "board-name",
  "sync-button",
  "about-open",
  "add-image",
  "zoom-out",
  "zoom-reset",
  "zoom-in",
];

function cursorOf(page: Page, testId: string) {
  return page
    .getByTestId(testId)
    .evaluate((element) => getComputedStyle(element).cursor);
}

function backgroundOf(page: Page, testId: string) {
  return page
    .getByTestId(testId)
    .evaluate((element) => getComputedStyle(element).backgroundColor);
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/chrome");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("every control the pointer can press says so", async ({ page }) => {
  for (const id of CORNER) {
    expect(await cursorOf(page, id), id).toBe("pointer");
  }
});

test("a control that cannot be pressed keeps the arrow", async ({ page }) => {
  // Nothing has been done to this board, so undo is disabled — and a disabled
  // control is the one case where the default arrow is the honest answer.
  await expect(page.getByTestId("undo")).toBeDisabled();
  expect(await cursorOf(page, "undo")).toBe("default");
});

test("every corner control lights up under the pointer", async ({ page }) => {
  for (const id of CORNER) {
    const resting = await backgroundOf(page, id);
    await page.getByTestId(id).hover();
    const hovered = await backgroundOf(page, id);
    // White at low alpha over whatever the control already sits on, which is
    // the app's one hover tint (docs/ui-guidelines.md). What matters here is
    // that there is one at all.
    expect(hovered, id).not.toBe(resting);
  }
});

test("the two glass weights stay two", async ({ page }) => {
  // `glass-strong` is `glass` plus more tint, applied in that order. If the
  // override ever lands before what it overrides, both surfaces come out the
  // same and panels lose the contrast that lets a paragraph sit over a
  // screenshot — a change that looks like nothing in the diff.
  const control = await backgroundOf(page, "board-menu");
  await page.getByTestId("sync-button").click();
  const panel = await backgroundOf(page, "sync-panel");
  expect(panel).not.toBe(control);
  // Both are the same neutral under the same blur; only the alpha differs.
  expect(panel).toContain("srgb");
  expect(control).toContain("srgb");
});
