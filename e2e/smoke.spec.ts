import { expect, test, type Page } from "@playwright/test";

/** Names of every stored board, read straight from IndexedDB. */
function storedNames(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open("canwas");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("boards")) {
            resolve([]);
            return;
          }
          const request = db
            .transaction("boards", "readonly")
            .objectStore("boards")
            .getAll();
          request.onsuccess = () =>
            resolve(request.result.map((board) => board.name));
        };
      }),
  );
}

test("opening the app lands on a board, creating one if none exist", async ({
  page,
}) => {
  await page.goto("/CanWas/");

  // No home screen: the root resolves straight to a board (D31).
  await expect(page).toHaveURL(/#\/board\/[0-9a-hjkmnp-tv-z]{12}$/);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await expect(page.getByTestId("board-name")).toHaveText("Untitled board");
  await page.screenshot({ path: "e2e/screenshots/landing.png" });
});

test("returning opens the most recently edited board, not a new one", async ({
  page,
}) => {
  await page.goto("/CanWas/");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.getByTestId("board-name").click();
  await page.getByTestId("board-name-input").fill("First board");
  await page.getByTestId("board-name-input").press("Enter");
  const first = page.url();

  // The write is async, and a navigation can abort one still in flight (D30).
  await expect.poll(() => storedNames(page)).toEqual(["First board"]);
  await page.goto("/CanWas/");
  await expect(page).toHaveURL(first);
  await expect(page.getByTestId("board-name")).toHaveText("First board");
});

test("the menu lists boards, creates and switches between them", async ({
  page,
}) => {
  await page.goto("/CanWas/");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const firstUrl = page.url();

  await page.getByTestId("board-menu").click();
  await expect(page.getByTestId("menu-board-item")).toHaveCount(1);
  await page.getByTestId("menu-new-board").click();

  await expect(page).not.toHaveURL(firstUrl);
  await page.getByTestId("board-menu").click();
  await expect(page.getByTestId("menu-board-item")).toHaveCount(2);
  await page.screenshot({ path: "e2e/screenshots/board-menu.png" });

  // Switch back to the first board through the list.
  await page.getByTestId("menu-board-item").last().click();
  await expect(page).toHaveURL(firstUrl);
});

test("deleting the current board falls through to another", async ({
  page,
}) => {
  await page.goto("/CanWas/");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const firstUrl = page.url();

  await page.getByTestId("board-menu").click();
  await page.getByTestId("menu-new-board").click();
  await expect(page).not.toHaveURL(firstUrl);

  await page.getByTestId("board-menu").click();
  await page.getByTestId("menu-delete-board").click();
  await page.getByTestId("confirm-delete").click();

  // Never left on a board that no longer exists.
  await expect(page).toHaveURL(firstUrl);
  await page.getByTestId("board-menu").click();
  await expect(page.getByTestId("menu-board-item")).toHaveCount(1);
});

test("deleting the last board creates a fresh one", async ({ page }) => {
  await page.goto("/CanWas/");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const firstUrl = page.url();

  await page.getByTestId("board-menu").click();
  await page.getByTestId("menu-delete-board").click();
  await page.getByTestId("confirm-delete").click();

  await expect(page).not.toHaveURL(firstUrl);
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("language switches to zh-TW and persists", async ({ page }) => {
  await page.goto("/CanWas/");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  await page.getByTestId("board-menu").click();
  await page.getByRole("menuitemradio", { name: "繁體中文" }).click();
  await expect(page.getByText("貼上或拖曳圖片到這裡")).toBeVisible();

  await page.reload();
  await expect(page.getByText("貼上或拖曳圖片到這裡")).toBeVisible();
});
