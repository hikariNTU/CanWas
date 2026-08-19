import { expect, test } from "@playwright/test";

test("home renders, creates a board, and routes into it", async ({ page }) => {
  await page.goto("/CanWas/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("No boards yet.")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/home.png", fullPage: true });

  await page.getByTestId("create-board").click();
  await expect(page).toHaveURL(/#\/board\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/board.png", fullPage: true });

  await page.getByRole("link", { name: "Back to boards" }).click();
  await expect(page.getByTestId("board-row")).toHaveCount(1);
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
