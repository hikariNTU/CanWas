import { expect, test, type Page } from "@playwright/test";

/**
 * Two tabs, one origin, one IndexedDB.
 *
 * Each tab has its own atoms and writes the *whole* board record when it saves,
 * so a tab holding a stale node list lands it on top of a newer one. The second
 * tab does not have to be edited to destroy work — it only has to be open, and
 * then saved.
 */

const BOARD = "twotabs";

async function pasteImage(page: Page, tint: number) {
  await page.evaluate(async (t) => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext("2d")!;
    context.fillStyle = `hsl(${t}, 70%, 85%)`;
    context.fillRect(0, 0, 160, 120);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "s.png", { type: "image/png" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, tint);
}

test("a second tab picks up the first tab's work", async ({ context }) => {
  const first = await context.newPage();
  await first.goto(`?engine=mock#/${BOARD}`);
  await expect(first.getByTestId("canvas-surface")).toBeVisible();

  const second = await context.newPage();
  await second.goto(`?engine=mock#/${BOARD}`);
  await expect(second.getByTestId("canvas-surface")).toBeVisible();

  await pasteImage(first, 30);
  await expect(first.getByTestId("board-node")).toHaveCount(1);

  // Without the channel this tab still shows an empty board, and its next save
  // writes that emptiness over the image.
  await expect(second.getByTestId("board-node")).toHaveCount(1, {
    timeout: 10000,
  });
});

test("the stale tab does not overwrite the fresh one", async ({ context }) => {
  const first = await context.newPage();
  await first.goto(`?engine=mock#/${BOARD}`);
  await expect(first.getByTestId("canvas-surface")).toBeVisible();

  const second = await context.newPage();
  await second.goto(`?engine=mock#/${BOARD}`);
  await expect(second.getByTestId("canvas-surface")).toBeVisible();

  await pasteImage(first, 50);
  await expect(first.getByTestId("board-node")).toHaveCount(1);
  await expect(second.getByTestId("board-node")).toHaveCount(1, {
    timeout: 10000,
  });

  // Now make the second tab save. Before the channel, it held an empty node
  // list and this is the write that destroyed the image.
  await pasteImage(second, 200);
  await expect(second.getByTestId("board-node")).toHaveCount(2);

  await first.reload();
  await expect(first.getByTestId("canvas-surface")).toBeVisible();
  await expect(first.getByTestId("board-node")).toHaveCount(2);
});

test("a board created in one tab appears in the other's menu", async ({
  context,
}) => {
  const first = await context.newPage();
  await first.goto(`?engine=mock#/${BOARD}`);
  await expect(first.getByTestId("canvas-surface")).toBeVisible();

  const second = await context.newPage();
  await second.goto(`?engine=mock#/${BOARD}`);
  await expect(second.getByTestId("canvas-surface")).toBeVisible();

  await first.getByTestId("board-menu").click();
  await first.getByTestId("menu-new-board").click();
  await expect(first.getByTestId("canvas-surface")).toBeVisible();
  await first.getByTestId("board-name").click();
  const field = first.getByTestId("board-name-input");
  await field.fill("Made Next Door");
  await field.press("Enter");

  await second.getByTestId("board-menu").click();
  await expect(second.getByText("Made Next Door")).toBeVisible({
    timeout: 10000,
  });
});
