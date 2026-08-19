import { expect, test } from "@playwright/test";

/**
 * Step 1 smoke test. The real happy path — paste an image, see a node, select
 * its text — arrives at step 8 once those features exist. This only proves the
 * app boots, routes, and switches language.
 */
test("home renders and routes to a board", async ({ page }) => {
  await page.goto("/CanWas/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/home.png", fullPage: true });

  await page.getByRole("link", { name: "Open demo board" }).click();

  await expect(page).toHaveURL(/#\/board\/demo$/);
  await expect(page.getByTestId("board-id")).toHaveText("demo");
  await page.screenshot({ path: "e2e/screenshots/board.png", fullPage: true });
});

test("language switches to zh-TW and persists", async ({ page }) => {
  await page.goto("/CanWas/");

  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitemradio", { name: "繁體中文" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("畫板");
  await page.screenshot({
    path: "e2e/screenshots/home-zh.png",
    fullPage: true,
  });

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("畫板");
});
