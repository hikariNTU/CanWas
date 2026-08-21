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

/**
 * Everything the control paints, tint and overlay together.
 *
 * Two properties rather than one because the hover is deliberately not
 * `background-color`: a glass control already has a tint in that slot, and a
 * hover written there replaces it instead of lightening it.
 */
function paintOf(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((element) => {
    const style = getComputedStyle(element);
    return `${style.backgroundColor} | ${style.backgroundImage}`;
  });
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
    const resting = await paintOf(page, id);
    await page.getByTestId(id).hover();
    const hovered = await paintOf(page, id);
    // White at low alpha over whatever the control already sits on, which is
    // the app's one hover tint (docs/ui-guidelines.md). What matters here is
    // that there is one at all.
    expect(hovered, id).not.toBe(resting);
  }
});

test("a glass control keeps its tint under the pointer", async ({ page }) => {
  // The bug this pins: `hover:bg-white/10` on a control that is itself glass
  // does not lighten the tint, it evicts it — and 10% white over a white
  // photograph is a control you cannot see. It was invisible for as long as
  // `glass` was a plain class, because an unlayered class outranked the hover
  // and the hover never ran; making `glass` a utility woke it up on four
  // controls at once.
  const resting = await backgroundOf(page, "board-menu");
  await page.getByTestId("board-menu").hover();
  expect(await backgroundOf(page, "board-menu")).toBe(resting);
  // The brightening moved to the layer above, where it composites.
  const painted = await paintOf(page, "board-menu");
  expect(painted).toContain("linear-gradient");
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
