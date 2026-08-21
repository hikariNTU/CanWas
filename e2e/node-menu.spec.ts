import { expect, test, type Page } from "@playwright/test";

import { pasteTextImage } from "./support";

/**
 * The node context menu (D83).
 *
 * Every item here is a keystroke on a desktop and nothing at all on a phone,
 * which is what the menu is for. The tests drive it with a right-click because
 * Playwright has no long press; the long press is the primitive's, and testing
 * it would be testing Base UI.
 */

async function paste(page: Page, tint = 0) {
  await page.evaluate(async (hue) => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 150;
    const context = canvas.getContext("2d")!;
    context.fillStyle = `hsl(${hue}, 70%, 85%)`;
    context.fillRect(0, 0, 200, 150);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "shot.png", { type: "image/png" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, tint);
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/menuboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a right-click on a node opens a menu that can delete it", async ({
  page,
}) => {
  await paste(page);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);

  await node.click({ button: "right" });
  await expect(page.getByTestId("node-menu")).toBeVisible();

  await page.getByTestId("node-menu-delete").click();
  await expect(node).toHaveCount(0);
});

test("copy from the menu puts the node on the system clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // `clipboard.write` refuses on a document that is not focused, and a page
  // running beside three others in parallel is not focused by default.
  await page.bringToFront();
  await paste(page);
  await page.getByTestId("board-node").click({ button: "right" });
  await page.getByTestId("node-menu-copy").click();

  // The same payload Cmd+C writes, by way of the async clipboard rather than a
  // copy event: a menu click is not one.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes("text/html")) {
            return (await item.getType("text/html")).text();
          }
        }
        return "";
      }),
    )
    .toContain("data-canwas");
});

test("right-clicking outside the selection acts on what was clicked", async ({
  page,
}) => {
  await paste(page, 0);
  await paste(page, 200);
  const nodes = page.getByTestId("board-node");
  await expect(nodes).toHaveCount(2);

  // Both pastes land centred, so the second sits exactly on the first and
  // nothing can be aimed at the one underneath. Drag it clear first.
  const box = (await nodes.last().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 320, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  // Select the first, then aim the menu at the second. Deleting must take the
  // one under the cursor and leave the selection's node alone.
  await nodes.first().click();
  await expect(nodes.first()).toHaveAttribute("data-selected", "true");

  await nodes.last().click({ button: "right" });
  await page.getByTestId("node-menu-delete").click();

  await expect(nodes).toHaveCount(1);
});

test("a whole selection is deleted together", async ({ page }) => {
  await paste(page, 0);
  await paste(page, 200);
  const nodes = page.getByTestId("board-node");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(nodes.first()).toHaveAttribute("data-selected", "true");

  await nodes.last().click({ button: "right" });
  await page.getByTestId("node-menu-delete").click();

  await expect(nodes).toHaveCount(0);
});

test("the text items appear only once there is text to take", async ({
  page,
}) => {
  await paste(page);
  const node = page.getByTestId("board-node");

  // Recognition has not run on a blank swatch, so neither item is offered:
  // "Copy text" would copy nothing and "Read text" would open an empty mode.
  await node.click({ button: "right" });
  await expect(page.getByTestId("node-menu-copy-text")).toHaveCount(0);
  await expect(page.getByTestId("node-menu-read")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A real page of text, read to completion.
  await pasteTextImage(page, ["Hello there", "second line"]);
  const read = page.getByTestId("board-node").last();
  await expect(read).toHaveAttribute("data-ocr-status", "done");

  await read.click({ button: "right" });
  await expect(page.getByTestId("node-menu-copy-text")).toBeVisible();
  await expect(page.getByTestId("node-menu-read")).toBeVisible();
});

test("reordering is reachable without a keyboard", async ({ page }) => {
  await paste(page, 0);
  await paste(page, 200);
  const nodes = page.getByTestId("board-node");

  // The newest node is on top. Sending it back must put the other one first in
  // document order, which is what the board's order key decides.
  const before = await nodes.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-node-id")),
  );
  await nodes.last().click({ button: "right" });
  await page.getByTestId("node-menu-back").click();

  await expect
    .poll(() =>
      nodes.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-node-id")),
      ),
    )
    .toEqual([before[1], before[0]]);
});

test("the highlighted item is not also ringed by the browser", async ({
  page,
}) => {
  await paste(page);
  await page.getByTestId("board-node").click({ button: "right" });

  // Base UI focuses the item it highlights, so without `outline-none` the
  // browser draws its own ring on top of the wash — two indicators for one
  // state, and the ring does not follow the item's rounding.
  await page.keyboard.press("ArrowDown");
  const item = page.getByTestId("node-menu-copy");
  await expect(item).toBeFocused();
  await expect(item).toHaveCSS("outline-style", "none");
});
