import { devices, expect, test, type Page } from "@playwright/test";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Everything that only exists on a phone.
 *
 * Emulated as a Pixel 7, which is what makes `(pointer: coarse)` match — the
 * query the whole mode chip hangs off (D70). A desktop project would report a
 * fine pointer and never render any of this.
 */
test.use({ ...devices["Pixel 7"] });

const root = fileURLToPath(new URL("..", import.meta.url));

async function pasteImage(page: Page, width: number, height: number) {
  await page.evaluate(
    async ({ w, h }) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#f5f5f5";
      context.fillRect(0, 0, w, h);
      context.fillStyle = "#0a0a0a";
      context.fillRect(w * 0.1, h * 0.1, w * 0.3, h * 0.3);
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
    },
    { w: width, h: height },
  );
}

async function centreOf(locator: ReturnType<Page["getByTestId"]>) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where the dotted grid sits, which is the viewport translation made visible. */
function gridOffset(page: Page) {
  return page
    .getByTestId("canvas-grid")
    .evaluate((element) => getComputedStyle(element).backgroundPosition);
}

/** A one-finger drag, as a real touch stream rather than a synthetic mouse. */
async function fingerDrag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
) {
  await page.evaluate(
    ({ start, delta }) => {
      const surface = document.querySelector("[data-testid=canvas-surface]")!;
      const target = document.elementFromPoint(start.x, start.y) ?? surface;
      const send = (type: string, x: number, y: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "touch",
            isPrimary: true,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      send("pointerdown", start.x, start.y);
      for (let step = 1; step <= 8; step += 1) {
        send(
          "pointermove",
          start.x + (delta.x * step) / 8,
          start.y + (delta.y * step) / 8,
        );
      }
      send("pointerup", start.x + delta.x, start.y + delta.y);
    },
    { start: from, delta: { x: dx, y: dy } },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/touch");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("the mode chip is there, and pan is the mode a phone starts in", async ({
  page,
}) => {
  await expect(page.getByTestId("touch-bar")).toBeVisible();
  await expect(page.getByTestId("mode-pan")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("mode-select")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Both chip glyphs are real Material Symbols rather than their own names.
  // The icon audit runs on a desktop project, where this control does not
  // exist at all, so it has to be measured here.
  await page.evaluate(() => document.fonts.ready);
  const glyphs = await page
    .getByTestId("touch-bar")
    .locator(".material-symbol")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        name: element.textContent ?? "",
        width: element.getBoundingClientRect().width,
        size: parseFloat(getComputedStyle(element).fontSize),
      })),
    );
  // Two modes plus the add button, all three ligatures.
  expect(glyphs).toHaveLength(3);
  for (const glyph of glyphs) {
    expect(
      glyph.width,
      `"${glyph.name}" is not a Material Symbols glyph`,
    ).toBeLessThan(glyph.size * 2);
  }

  await page.screenshot({ path: "e2e/screenshots/touch-chip.png" });
});

test("in pan mode a finger on top of an image moves the board, not the image", async ({
  page,
}) => {
  // Wider than the phone, so there is no empty canvas left to grab — the case
  // that made panning impossible before the chip existed.
  await pasteImage(page, 1200, 900);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  const node = page.getByTestId("board-node");
  const grid = await gridOffset(page);
  const box = (await node.boundingBox())!;
  await fingerDrag(page, await centreOf(node), 60, 40);

  // The board moved under the finger, and the image moved exactly with it —
  // which is what "the image did not move" means once the view has shifted.
  expect(await gridOffset(page), "the viewport did not move").not.toBe(grid);
  const after = (await node.boundingBox())!;
  expect(after.x - box.x).toBeCloseTo(60, 0);
  expect(after.y - box.y).toBeCloseTo(40, 0);
});

test("select mode gives the same drag to the image", async ({ page }) => {
  await pasteImage(page, 1200, 900);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  await page.getByTestId("mode-select").click();

  const node = page.getByTestId("board-node");
  const grid = await gridOffset(page);
  const box = (await node.boundingBox())!;
  await fingerDrag(page, await centreOf(node), 60, 40);

  // Same gesture, opposite owner: here the image moves across a board that
  // stayed exactly where it was.
  expect(await gridOffset(page), "the viewport moved").toBe(grid);
  const after = (await node.boundingBox())!;
  expect(after.x - box.x).toBeCloseTo(60, 0);
});

test("a tap selects, and the selection bar deletes what a keyboard cannot", async ({
  page,
}) => {
  await pasteImage(page, 600, 400);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);
  await expect(page.getByTestId("delete-selection")).toHaveCount(0);

  // Still in pan mode: the tap has to hand the press back to the node, or
  // nothing on a phone can ever be selected.
  const centre = await centreOf(node);
  await page.touchscreen.tap(centre.x, centre.y);
  await expect(node).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("delete-selection")).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/touch-selection.png" });

  await page.getByTestId("delete-selection").click();
  await expect(page.getByTestId("board-node")).toHaveCount(0);
  await expect(page.getByTestId("delete-selection")).toHaveCount(0);

  // Deleting by finger is the same change as deleting by key: one undo.
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("board-node")).toHaveCount(1);
});

test("a tap on empty canvas clears, and a pan does not", async ({ page }) => {
  await pasteImage(page, 300, 200);
  const node = page.getByTestId("board-node");
  const centre = await centreOf(node);
  await page.touchscreen.tap(centre.x, centre.y);
  await expect(node).toHaveAttribute("data-selected", "true");

  // Dragging from empty canvas is a pan. The selection — and with it the only
  // delete button this device has — must survive it.
  await fingerDrag(page, { x: 30, y: 500 }, 0, -120);
  await expect(node).toHaveAttribute("data-selected", "true");

  await page.touchscreen.tap(30, 500);
  await expect(node).not.toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("delete-selection")).toHaveCount(0);
});

test("holding the board does not select the whole page as text", async ({
  page,
}) => {
  await pasteImage(page, 600, 400);

  const styles = await page.evaluate(() => {
    const surface = document.querySelector("[data-testid=canvas-surface]")!;
    return { select: getComputedStyle(surface).userSelect };
  });
  expect(styles.select, "a long press can select the canvas").toBe("none");

  // The callout is the iOS half and Chromium does not implement it, so it
  // computes to nothing here however it is declared. The rule itself is what
  // can be checked: without it, holding an image on an iPhone still raises the
  // copy/share sheet even with selection off (D69).
  const css = readFileSync(root + "src/index.css", "utf8");
  expect(css, "the iOS callout suppression is gone").toMatch(
    /\.canvas-surface\s*\{[^}]*-webkit-touch-callout:\s*none/,
  );

  // The one exception, and the reason this is a rule with a hole in it rather
  // than a blanket: recognised text is real text, and long-press is the only
  // way to copy it on a phone (D69).
  const overlay = await page.evaluate(() => {
    const style = document.createElement("style");
    document.head.append(style);
    const probe = document.createElement("span");
    probe.className = "ocr-word";
    document.querySelector("[data-testid=canvas-surface]")!.append(probe);
    const value = getComputedStyle(probe).userSelect;
    probe.remove();
    style.remove();
    return value;
  });
  expect(overlay, "recognised text can no longer be selected").toBe("text");
});

test("the chrome holds itself clear of a cutout", async ({ page }) => {
  // `env(safe-area-inset-*)` resolves to 0 in a headless browser, so the
  // measurable half is that every island is inside the padded layer and the
  // canvas is not — that is what makes one rule move all of them (D68).
  const layered = await page.evaluate(() => {
    const layer = document.querySelector(".chrome-layer");
    const chip = document.querySelector("[data-testid=touch-bar]");
    const surface = document.querySelector("[data-testid=canvas-surface]");
    return {
      exists: layer !== null,
      holdsChip: layer?.contains(chip ?? null) ?? false,
      holdsCanvas: layer?.contains(surface ?? null) ?? false,
    };
  });
  expect(layered.exists, "no chrome layer to carry the insets").toBe(true);
  expect(layered.holdsChip).toBe(true);
  expect(layered.holdsCanvas, "the canvas must stay full bleed").toBe(false);

  // And the declaration itself, which no amount of DOM inspection can reach.
  const html = readFileSync(root + "index.html", "utf8");
  expect(html, "without viewport-fit=cover the insets are always 0").toContain(
    "viewport-fit=cover",
  );
});

test("the touch controls sit above the corner islands, never on them", async ({
  page,
}) => {
  await pasteImage(page, 600, 400);
  const node = page.getByTestId("board-node");
  const centre = await centreOf(node);
  await page.touchscreen.tap(centre.x, centre.y);
  // Measured with a selection, which is the bar at its widest: the delete
  // button exists only while something is selected.
  await expect(page.getByTestId("delete-selection")).toBeVisible();

  // A phone is 412px across. The bar is wide enough to reach the bottom-left
  // corner from the centre, so "bottom centre" and "bottom left" are not two
  // free places to put things — they are one, unless the bar is lifted a row.
  const overlaps = async (a: string, b: string) => {
    const first = (await page.getByTestId(a).boundingBox())!;
    const second = (await page.getByTestId(b).boundingBox())!;
    return (
      first.x < second.x + second.width &&
      second.x < first.x + first.width &&
      first.y < second.y + second.height &&
      second.y < first.y + first.height
    );
  };

  for (const island of ["undo", "redo", "zoom-reset"]) {
    expect(
      await overlaps("touch-bar", island),
      `the bar covers ${island}`,
    ).toBe(false);
  }

  // The add button is inside the bar now rather than floating in the corner
  // behind it, which is why it is not in the list above.
  const inside = await page.evaluate(() => {
    const bar = document.querySelector("[data-testid=touch-bar]");
    const add = document.querySelector("[data-testid=add-image]");
    return bar?.contains(add ?? null) ?? false;
  });
  expect(inside, "the add button is not in the bar").toBe(true);
});

test("in select mode a finger on empty canvas lassos, and only lassos", async ({
  page,
}) => {
  await pasteImage(page, 240, 160);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);
  await page.getByTestId("mode-select").click();

  const grid = await gridOffset(page);
  const box = (await node.boundingBox())!;
  // From clear canvas above the node, down across it.
  await fingerDrag(
    page,
    { x: box.x - 30, y: box.y - 60 },
    box.width + 60,
    box.height + 90,
  );

  await expect(node).toHaveAttribute("data-selected", "true");
  // Both handlers used to claim the same press: the board slid under the
  // finger while a marquee was being drawn on it. One press, one gesture.
  expect(await gridOffset(page), "the marquee also panned the board").toBe(
    grid,
  );
});

test("every control a finger can hit is round and at least 44px", async ({
  page,
}) => {
  await pasteImage(page, 240, 160);
  const node = page.getByTestId("board-node");
  await page.touchscreen.tap(
    (await centreOf(node)).x,
    (await centreOf(node)).y,
  );
  await expect(page.getByTestId("delete-selection")).toBeVisible();

  // 44pt is the minimum touch target in Apple's Human Interface Guidelines,
  // and the number every phone-sized control here is built around. The desktop
  // islands are 32px and stay that way — `pointer-coarse:` is what separates
  // them, so this is measurable only on a coarse pointer.
  const controls = [
    "board-menu",
    "board-name",
    "sync-button",
    "about-open",
    "undo",
    "redo",
    "zoom-reset",
    "mode-pan",
    "mode-select",
    "add-image",
    "delete-selection",
  ];

  for (const id of controls) {
    const measured = await page.getByTestId(id).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius);
      return { width: rect.width, height: rect.height, radius };
    });
    expect(measured.height, `${id} is under 44px tall`).toBeGreaterThanOrEqual(
      44,
    );
    expect(measured.width, `${id} is under 44px wide`).toBeGreaterThanOrEqual(
      44,
    );
    // Fully rounded: a pill's radius is half its height, and Tailwind's
    // `rounded-full` resolves to a number far larger, which the browser clamps.
    expect(
      measured.radius,
      `${id} is not fully rounded`,
    ).toBeGreaterThanOrEqual(measured.height / 2);
  }
});

test("the resize handle belongs to select mode only", async ({ page }) => {
  await pasteImage(page, 300, 200);
  const node = page.getByTestId("board-node");
  const centre = await centreOf(node);
  await page.touchscreen.tap(centre.x, centre.y);
  await expect(node).toHaveAttribute("data-selected", "true");

  // Pan mode gives the press under the handle to the viewport, so drawing one
  // would advertise a gesture the mode does not have.
  await expect(page.getByTestId("resize-handle")).toHaveCount(0);

  await page.getByTestId("mode-select").click();
  await expect(page.getByTestId("resize-handle")).toBeVisible();
});
