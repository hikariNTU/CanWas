import { expect, test, type Page } from "@playwright/test";

import { pasteTextImage, storedAssets } from "./support";

/**
 * Copying nodes and pasting them back.
 *
 * One test drives a real Cmd/Ctrl+C against the OS clipboard, because that is
 * the thing that was broken — a key press that produced nothing. The rest go
 * through synthetic clipboard events, which is the only way to drive a paste
 * (D21) and is why copy writes its payload synchronously.
 */

async function pasteImage(page: Page, width: number, height: number, tint = 0) {
  await page.evaluate(
    async ({ w, h, tint }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      context.fillStyle = `hsl(${tint}, 70%, 85%)`;
      context.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([blob!], `shot-${tint}.png`, { type: "image/png" }),
      );
      window.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { w: width, h: height, tint },
  );
}

/** Dispatches a copy and hands back whatever the app wrote on it. */
async function copyFlavours(page: Page) {
  return page.evaluate(() => {
    const transfer = new DataTransfer();
    const event = new ClipboardEvent("copy", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      html: transfer.getData("text/html"),
      text: transfer.getData("text/plain"),
    };
  });
}

async function pasteFlavours(
  page: Page,
  flavours: { html: string; text: string },
) {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    if (data.html !== "") {
      transfer.setData("text/html", data.html);
    }
    if (data.text !== "") {
      transfer.setData("text/plain", data.text);
    }
    window.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, flavours);
}

async function makeTextNode(page: Page, text: string, atX: number) {
  const surface = (await page.getByTestId("canvas-surface").boundingBox())!;
  await page.mouse.dblclick(surface.x + atX, surface.y + 200);
  await page.keyboard.type(text);
  await page.mouse.click(surface.x + 60, surface.y + surface.height - 60);
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/copyboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a real Cmd+C writes the selected node to the system clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await pasteImage(page, 320, 240);
  const node = page.getByTestId("board-node");
  await node.click();
  await expect(node).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("ControlOrMeta+c");

  const html = await page.evaluate(async () => {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes("text/html")) {
        return (await item.getType("text/html")).text();
      }
    }
    return "";
  });
  expect(html).toContain("data-canwas");
});

test("pasting a copied image is a second node over one asset", async ({
  page,
}) => {
  await pasteImage(page, 320, 240);
  const nodes = page.getByTestId("board-node");
  await nodes.click();

  const copied = await copyFlavours(page);
  expect(copied.prevented).toBe(true);
  await pasteFlavours(page, copied);

  await expect(nodes).toHaveCount(2);
  // The pixels are not copied, only the id that names them (D13).
  expect(await storedAssets(page)).toHaveLength(1);

  // The copy landed beside the original rather than under it, and it is what
  // is selected now.
  const boxes = await nodes.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().x),
  );
  expect(boxes[0]).not.toBeCloseTo(boxes[1]!, 0);
  await expect(nodes.last()).toHaveAttribute("data-selected", "true");

  // And it is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes).toHaveCount(1);
});

test("a copied text node also copies as plain text", async ({ page }) => {
  await makeTextNode(page, "Cadmium red", 420);
  const node = page.getByTestId("board-node");
  await node.click();

  const copied = await copyFlavours(page);
  expect(copied.text).toBe("Cadmium red");
  expect(copied.html).toContain("data-canwas");

  await pasteFlavours(page, copied);
  await expect(page.getByTestId("board-node")).toHaveCount(2);
  await expect(page.getByTestId("text-node-body").last()).toHaveText(
    "Cadmium red",
  );
});

test("a clipboard from another app still pastes as text", async ({ page }) => {
  await pasteFlavours(page, {
    html: "<meta charset='utf-8'><p>Ultramarine</p>",
    text: "Ultramarine",
  });
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await expect(page.getByTestId("text-node-body")).toHaveText("Ultramarine");
});

test("reading mode leaves the clipboard to the recognized text", async ({
  page,
}) => {
  await pasteTextImage(page, ["Titanium white"]);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveAttribute("data-ocr-status", "done");
  const box = (await node.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("ocr-overlay")).toHaveAttribute(
    "data-active",
    "true",
  );

  // The node is selected — reading mode selects it — so without the guard the
  // board would overwrite the words with its own payload.
  const copied = await copyFlavours(page);
  expect(copied.prevented).toBe(false);
  expect(copied.html).toBe("");
});
