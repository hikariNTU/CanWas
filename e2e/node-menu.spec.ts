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

test("copy from the menu hands the clipboard the same payload Cmd+C does", async ({
  page,
}) => {
  // The write is recorded rather than performed. Both halves of the clipboard
  // API refuse on a document that is not focused, and a page sharing a machine
  // with three other workers cannot hold focus — so driving the real clipboard
  // here tests the harness, not the app. What the OS does with a well-formed
  // ClipboardItem is settled, and `copy.spec.ts` proves the round trip once for
  // the keyboard path.
  await page.addInitScript(() => {
    const written: Record<string, string>[] = [];
    (window as unknown as { __written: unknown }).__written = written;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          for (const item of items) {
            const flavours: Record<string, string> = {};
            for (const type of item.types) {
              flavours[type] = await (await item.getType(type)).text();
            }
            written.push(flavours);
          }
        },
        writeText: async (text: string) => {
          written.push({ "text/plain": text });
        },
      },
    });
  });

  await page.reload();
  await paste(page);
  await page.getByTestId("board-node").click({ button: "right" });
  await page.getByTestId("node-menu-copy").click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __written: Record<string, string>[] })
            .__written,
      ),
    )
    .toEqual([{ "text/html": expect.stringContaining("data-canwas") }]);
});

test("copy text takes the recognised words and nothing else", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const written: string[] = [];
    (window as unknown as { __text: unknown }).__text = written;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
  });

  await page.reload();
  await pasteTextImage(page, ["Hello there", "second line"]);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveAttribute("data-ocr-status", "done");

  await node.click({ button: "right" });
  await page.getByTestId("node-menu-copy-text").click();

  // The mock recognizer invents its own words (D41), so what is asserted is
  // the shape rather than the letters: one write, plain text, the words joined
  // — and emphatically not the node payload the other item writes.
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __text: string[] }).__text),
    )
    .toEqual([expect.not.stringContaining("data-canwas")]);

  const [copied] = await page.evaluate(
    () => (window as unknown as { __text: string[] }).__text,
  );
  expect(copied!.split(" ").length).toBeGreaterThan(1);
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
  // The popup takes focus before any item does, so it is ringed first.
  await expect(page.getByTestId("node-menu")).toHaveCSS(
    "outline-style",
    "none",
  );

  await page.keyboard.press("ArrowDown");
  const item = page.getByTestId("node-menu-copy");
  await expect(item).toBeFocused();
  await expect(item).toHaveCSS("outline-style", "none");
});

test("items name the keyboard route to the same action", async ({ page }) => {
  await paste(page);
  await page.getByTestId("board-node").click({ button: "right" });

  // A mouse is what this test has, so the hints are shown. On a touch screen
  // the same markup hides them: naming a key nobody has is noise in the one
  // place the menu is the only route rather than a convenience.
  await expect(page.getByTestId("node-menu-copy")).toContainText(/⌘C|Ctrl C/);
  await expect(page.getByTestId("node-menu-front")).toContainText("]");
  await expect(page.getByTestId("node-menu-back")).toContainText("[");
  await expect(page.getByTestId("node-menu-delete")).toContainText(/⌫|Del/);
});
