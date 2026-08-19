import { expect, test, type Page } from "@playwright/test";

async function pasteText(page: Page, text: string) {
  await page.evaluate((value) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", value);
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

async function surfaceBox(page: Page) {
  const box = await page.getByTestId("canvas-surface").boundingBox();
  if (!box) {
    throw new Error("no canvas surface");
  }
  return box;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/CanWas/#/textboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("double-clicking empty canvas creates a text node ready to type", async ({
  page,
}) => {
  const surface = await surfaceBox(page);
  const at = { x: surface.x + surface.width * 0.6, y: surface.y + 220 };
  await page.mouse.dblclick(at.x, at.y);

  const input = page.getByTestId("text-node-input");
  await expect(input).toBeFocused();

  await page.keyboard.type("Colour reference");
  await page.mouse.click(surface.x + 60, surface.y + surface.height - 60);

  const node = page.getByTestId("board-node");
  await expect(node).toHaveAttribute("data-node-kind", "text");
  await expect(page.getByTestId("text-node-body")).toHaveText(
    "Colour reference",
  );

  // It landed where it was created.
  const box = (await node.boundingBox())!;
  expect(box.y).toBeCloseTo(at.y, -1);

  await page.screenshot({ path: "e2e/screenshots/text-node.png" });
});

test("an empty text node is discarded rather than stranded", async ({
  page,
}) => {
  const surface = await surfaceBox(page);
  await page.mouse.dblclick(surface.x + 400, surface.y + 200);
  await expect(page.getByTestId("text-node-input")).toBeFocused();

  // Typed nothing, then clicked away. An empty node would be invisible and
  // unselectable, so it must not survive.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-node")).toHaveCount(0);
});

test("pasting text creates a text node at the cursor", async ({ page }) => {
  const surface = await surfaceBox(page);
  const cursor = {
    x: surface.x + surface.width * 0.7,
    y: surface.y + surface.height * 0.4,
  };
  await page.mouse.move(cursor.x, cursor.y);
  await pasteText(page, "npm run check\nall checks passed");

  const node = page.getByTestId("board-node");
  await expect(node).toHaveAttribute("data-node-kind", "text");
  await expect(page.getByTestId("text-node-body")).toContainText(
    "all checks passed",
  );

  const box = (await node.boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(cursor.x, -1);
});

test("long pasted text is truncated", async ({ page }) => {
  await pasteText(page, "x".repeat(5000));

  const text = await page.getByTestId("text-node-body").textContent();
  expect(text!.length).toBe(2000);
  expect(text!.endsWith("…")).toBe(true);
});

test("editing text is one undo step, and double-click reopens it", async ({
  page,
}) => {
  const surface = await surfaceBox(page);
  await page.mouse.dblclick(surface.x + 500, surface.y + 250);
  await page.keyboard.type("first");
  await page.mouse.click(surface.x + 60, surface.y + surface.height - 60);
  await expect(page.getByTestId("text-node-body")).toHaveText("first");

  // Reopen by double-clicking the node itself.
  await page.getByTestId("board-node").dblclick();
  await expect(page.getByTestId("text-node-input")).toBeFocused();
  await page.keyboard.type(" pass");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("text-node-body")).toHaveText("first pass");

  // The edit and its measured height undo together, as one action.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("text-node-body")).toHaveText("first");
});

test("typing in a text node does not trigger board shortcuts", async ({
  page,
}) => {
  const surface = await surfaceBox(page);
  await page.mouse.dblclick(surface.x + 500, surface.y + 250);
  await page.keyboard.type("keep me");
  // Backspace and Select All belong to the text, not the board.
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("text-node-body")).toHaveText("keep m");
});

test("text nodes and images coexist, and text survives a reload", async ({
  page,
}) => {
  const surface = await surfaceBox(page);
  await page.mouse.dblclick(surface.x + 300, surface.y + 200);
  await page.keyboard.type("Palette notes");
  await page.keyboard.press("Escape");

  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 150;
    canvas.getContext("2d")!.fillStyle = "#cbe8b7";
    canvas.getContext("2d")!.fillRect(0, 0, 200, 150);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob!], "a.png", { type: "image/png" }));
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await expect(page.getByTestId("board-node")).toHaveCount(2);
  await expect.poll(() => page.getByTestId("board-node").count()).toBe(2);
  await page.waitForTimeout(700);
  await page.reload();

  await expect(page.getByTestId("board-node")).toHaveCount(2);
  await expect(page.getByTestId("text-node-body")).toHaveText("Palette notes");
});

test("text size presets apply and undo", async ({ page }) => {
  const surface = await surfaceBox(page);
  await page.mouse.dblclick(surface.x + 400, surface.y + 200);
  await page.keyboard.type("Sizing");
  await page.keyboard.press("Escape");

  const node = page.getByTestId("board-node");
  await node.click();

  const body = page.getByTestId("text-node-body");
  await expect(body).toHaveCSS("font-size", "16px");
  await expect(page.getByTestId("font-size-16")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByTestId("font-size-40").click();
  await expect(body).toHaveCSS("font-size", "40px");
  // The control must show which size is active, not just apply it.
  await expect(page.getByTestId("font-size-40")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("font-size-16")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.screenshot({ path: "e2e/screenshots/text-size.png" });

  await page.keyboard.press("ControlOrMeta+z");
  await expect(body).toHaveCSS("font-size", "16px");
});

test("the size control appears only for a single selected text node", async ({
  page,
}) => {
  const surface = await surfaceBox(page);
  await expect(page.getByTestId("font-size-16")).toHaveCount(0);

  await page.mouse.dblclick(surface.x + 400, surface.y + 200);
  await page.keyboard.type("one");
  await page.keyboard.press("Escape");
  await page.getByTestId("board-node").click();
  await expect(page.getByTestId("font-size-16")).toBeVisible();

  // A second selected node makes the target ambiguous, so it hides.
  await page.mouse.dblclick(surface.x + 700, surface.y + 400);
  await page.keyboard.type("two");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("font-size-16")).toHaveCount(0);
});
