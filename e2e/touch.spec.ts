import { devices, expect, test, type Page } from "@playwright/test";

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PNG, pasteTextImage } from "./support";

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

/**
 * A two-finger pinch, centred on `at`, going from `from` to `to` pixels apart.
 *
 * Both fingers move, which is what a real pinch looks like and what stops the
 * midpoint from wandering; a test that moved one finger would be testing a drag
 * with a spectator.
 */
async function pinch(
  page: Page,
  at: { x: number; y: number },
  from: number,
  to: number,
) {
  await page.evaluate(
    ({ centre, start, end }) => {
      const surface = document.querySelector("[data-testid=canvas-surface]")!;
      const target = document.elementFromPoint(centre.x, centre.y) ?? surface;
      const send = (type: string, id: number, x: number, y: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: "touch",
            isPrimary: id === 1,
            button: 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      const spread = (gap: number) => [
        { x: centre.x - gap / 2, y: centre.y },
        { x: centre.x + gap / 2, y: centre.y },
      ];
      const [a0, b0] = spread(start);
      send("pointerdown", 1, a0!.x, a0!.y);
      send("pointerdown", 2, b0!.x, b0!.y);
      for (let step = 1; step <= 8; step += 1) {
        const [a, b] = spread(start + ((end - start) * step) / 8);
        send("pointermove", 1, a!.x, a!.y);
        send("pointermove", 2, b!.x, b!.y);
      }
      const [a1, b1] = spread(end);
      send("pointerup", 1, a1!.x, a1!.y);
      send("pointerup", 2, b1!.x, b1!.y);
    },
    { centre: at, start: from, end: to },
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
    .locator("[data-icon]")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        name: element.textContent ?? "",
        width: element.getBoundingClientRect().width,
        size: parseFloat(getComputedStyle(element).fontSize),
      })),
    );
  // Two modes plus the library and the camera, all four ligatures.
  expect(glyphs).toHaveLength(4);
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
  // A page of text rather than a blank swatch, because the second half of this
  // test needs a recognised word to ask about.
  await pasteTextImage(page, ["Hold me", "and copy"]);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveAttribute("data-ocr-status", "done");

  const styles = await page.evaluate(() => {
    const surface = document.querySelector("[data-testid=canvas-surface]")!;
    return { select: getComputedStyle(surface).userSelect };
  });
  expect(styles.select, "a long press can select the canvas").toBe("none");

  // The callout is the iOS half and Chromium does not implement it, so it
  // computes to nothing here however it is declared — the declaration itself is
  // all that can be checked. Without it, holding an image on an iPhone raises
  // the copy/share sheet even with selection off (D69).
  await expect(
    page.getByTestId("canvas-surface"),
    "the iOS callout suppression is gone",
  ).toHaveClass(/\[-webkit-touch-callout:none\]/);

  // The one exception, and the reason this is a rule with a hole in it rather
  // than a blanket: recognised text is real text, and long-press is the only
  // way to copy it on a phone (D69).
  // Asked of a real recognised word rather than of a synthetic probe: the
  // words are styled from one constant shared with the code that measures
  // them, and a probe assembled here would only assert what this test itself
  // wrote down. They exist only in reading mode, which is also the only place
  // selecting them means anything — two taps to get in.
  const box = (await node.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const word = page
    .locator("[data-testid=ocr-overlay][data-active] [data-word]")
    .first();
  await expect(word).toBeAttached();
  await expect(word, "recognised text can no longer be selected").toHaveCSS(
    "user-select",
    "text",
  );
});

test("the chrome holds itself clear of a cutout", async ({ page }) => {
  // `env(safe-area-inset-*)` resolves to 0 in a headless browser, so the
  // measurable half is that every island is inside the padded layer and the
  // canvas is not — that is what makes one rule move all of them (D68).
  const layered = await page.evaluate(() => {
    const layer = document.querySelector("[data-testid=chrome-layer]");
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

  // That the insets actually move something, which is the assertion three
  // rounds of this went without. Padding on the layer moved nothing: an
  // absolutely positioned child measures `top` from inside the border, and the
  // padding box it is laid out against includes the padding rather than
  // starting after it. The layer's own offsets do move it (D99). Driven with
  // an inline style because `env()` resolves to 0 in every browser this suite
  // can reach.
  const moved = await page.evaluate(() => {
    const layer = document.querySelector(
      "[data-testid=chrome-layer]",
    ) as HTMLElement;
    const menu = document.querySelector("[data-testid=board-menu]")!;
    const before = menu.getBoundingClientRect().top;
    layer.style.top = "62px";
    const after = menu.getBoundingClientRect().top;
    layer.style.top = "";
    return after - before;
  });
  expect(moved, "the layer's inset does not carry its islands").toBe(62);

  // The insets themselves, which resolve to 0 here and so cannot be measured.
  // One class rather than four utilities, because iOS needs a floor under the
  // top one and `max()` does not fit in a class name (D96).
  await expect(page.getByTestId("chrome-layer")).toHaveClass(/chrome-inset/);
  const css = readFileSync(root + "src/index.css", "utf8");
  expect(css, "the insets are not declared anywhere").toContain(
    "env(safe-area-inset-top)",
  );
  expect(
    css,
    "a browser that reports 0 where it should not still needs a floor",
  ).toContain("max(env(safe-area-inset-top), 44px)");
  // The bottom absorbs the islands' own 12px gutter rather than stacking with
  // it (D101). Asserted against the built stylesheet as well as the source,
  // because this rule was written once, lost before it was committed, and
  // shipped as a passing test and a decision describing CSS that was not there.
  expect(css, "the bottom inset does not absorb the gutter").toContain(
    "max(calc(env(safe-area-inset-bottom) - 12px), 0px)",
  );
  const assets = root + "dist/assets/";
  const stylesheet = readdirSync(assets).find(
    (name) => name.startsWith("app-") && name.endsWith(".css"),
  );
  const built = readFileSync(assets + stylesheet, "utf8");
  expect(built, "the built CSS lost the bottom inset").toContain(
    "max(calc(env(safe-area-inset-bottom) - 12px)",
  );
  // Offsets, not padding: the whole point of D99.
  expect(css, "the layer is padded rather than inset").not.toContain(
    "padding-top: env(safe-area-inset-top)",
  );

  // The update banner is the one piece of chrome outside the canvas, and it
  // appears without being asked for — under the clock, on a phone, unless it
  // carries the same layer (D103). Read from the source because it only renders
  // when a service worker has an update waiting, which no test here can stage.
  const prompt = readFileSync(root + "src/pwa/update-prompt.tsx", "utf8");
  expect(prompt, "the update banner has no safe-area layer").toContain(
    'className="chrome-inset"',
  );

  // And the declaration itself, which no amount of DOM inspection can reach.
  const html = readFileSync(root + "index.html", "utf8");
  expect(html, "without viewport-fit=cover the insets are always 0").toContain(
    "viewport-fit=cover",
  );
  // And its other half. On an installed iPhone app `viewport-fit=cover` alone
  // changes nothing: iOS reserves the status bar unless the page asks for it
  // by name, and the reserved band is painted with the manifest's
  // `background_color` — the board's own near-black, so the only visible
  // symptom is dots that stop short of the top (D93).
  expect(
    html,
    "without black-translucent iOS keeps the status bar for itself",
  ).toContain('content="black-translucent"');
  // And the flag that style is conditional on: it is a WebKit extension read
  // only for an app in Apple's own standalone mode, so on its own the line
  // above is decoration (D93).
  expect(
    html,
    "the status bar style is only read in Apple's standalone mode",
  ).toContain('name="apple-mobile-web-app-capable"');
});

test("the board is the size of the screen, not of its ancestors", async ({
  page,
}) => {
  // `h-full` is a chain of percentages and every link has to be exactly the
  // screen. Installed on a phone one of them was not, and the dots stopped
  // short of the bottom edge; asking the viewport directly cannot go wrong
  // that way (D96).
  const measured = await page.evaluate(() => {
    const surface = document.querySelector("[data-testid=canvas-surface]")!;
    const rect = surface.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      position: getComputedStyle(surface.parentElement!).position,
    };
  });
  expect(measured.position).toBe("fixed");
  expect(measured.width).toBe(measured.innerWidth);
  expect(measured.height).toBe(measured.innerHeight);
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
    "take-photo",
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

test("two fingers zoom the board, in both modes", async ({ page }) => {
  await pasteImage(page, 300, 200);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);
  const before = (await node.boundingBox())!;

  await pinch(
    page,
    await centreOf(page.getByTestId("canvas-surface")),
    100,
    300,
  );
  const spread = (await node.boundingBox())!;
  expect(spread.width).toBeGreaterThan(before.width * 1.5);

  // And the same gesture in select mode, where one finger drags a node: a
  // second finger has to outrank that, or an image can never be zoomed while
  // it is the thing under the fingers.
  await page.getByTestId("mode-select").click();
  await pinch(page, await centreOf(node), 300, 100);
  const pinched = (await node.boundingBox())!;
  expect(pinched.width).toBeLessThan(spread.width * 0.7);
});

test("a pinch on an image zooms it without moving it", async ({ page }) => {
  await pasteImage(page, 300, 200);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);
  const before = (await node.boundingBox())!;

  // Started right on the image and in select mode, which is the case that used
  // to be impossible: the first finger begins a node drag, and unless the pinch
  // takes the gesture away the image ends up somewhere else entirely.
  await page.getByTestId("mode-select").click();
  await pinch(page, await centreOf(node), 120, 260);

  // Back to 1:1, where the same board geometry has to draw the same rectangle.
  await page.getByTestId("zoom-reset").click();
  const after = (await node.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThan(2);
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  expect(Math.abs(after.width - before.width)).toBeLessThan(2);
});

test("while reading, a finger on the words selects instead of panning", async ({
  page,
}) => {
  await pasteTextImage(page, ["Titanium white", "Cadmium red"]);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveAttribute("data-ocr-status", "done");
  const box = (await node.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const overlay = page.locator("[data-testid=ocr-overlay][data-active]");
  await expect(overlay).toHaveCount(1);

  // A drag along a line of text. On a phone this is the only way to extend a
  // selection, and while the board panned under it the words moved with the
  // finger — so the selection could never grow past where it started.
  const word = (await overlay.locator("[data-word]").first().boundingBox())!;
  const grid = await gridOffset(page);
  await fingerDrag(
    page,
    { x: word.x + 2, y: word.y + word.height / 2 },
    Math.round(word.width * 4),
    0,
  );
  expect(await gridOffset(page)).toBe(grid);

  // Two fingers are still a pinch, even here: reading mode has no zoom of its
  // own, and a screenshot is read at whatever size it is legible at.
  const before = (await node.boundingBox())!;
  await pinch(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    80,
    240,
  );
  const after = (await node.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width * 1.4);
});

test("the camera is its own button, and asks for the camera", async ({
  page,
}) => {
  const camera = page.getByTestId("take-photo");
  await expect(camera).toBeVisible();

  const inside = await page.evaluate(() => {
    const bar = document.querySelector("[data-testid=touch-bar]");
    return (
      bar?.contains(document.querySelector("[data-testid=take-photo]")) ?? false
    );
  });
  expect(inside, "the camera button is not in the bar").toBe(true);

  // `capture` is the whole point: without it Android Chrome opens the photo
  // library, which is what the button beside this one already does.
  const input = page.getByTestId("take-photo-input");
  await expect(input).toHaveAttribute("capture", "environment");
  await expect(input).toHaveAttribute("accept", "image/*");
  // A camera hands back one frame, and `multiple` alongside `capture` is
  // ignored anyway — so it is not claimed.
  await expect(input).not.toHaveAttribute("multiple", /.*/);

  // Same ingest path as every other image, so what it produces is a node that
  // gets read like the rest (D78).
  await input.setInputFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);
  await expect(node).toHaveAttribute("data-node-kind", "image");
  await expect(node).toHaveAttribute("data-ocr-status", /queued|running|done/);
});

test("a finger the surface never saw lift does not turn the next one into a pinch", async ({
  page,
}) => {
  await page.goto("?engine=mock#/board");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  const centre = { x: 200, y: 400 };

  // A finger lands on the board, and its release goes somewhere else. That is
  // what a long-press menu does to it: the menu opens over the finger, and the
  // `pointerup` is retargeted into the portal the surface's listeners cannot
  // see. Reproduced by dispatching the release on `document.body`, which is an
  // ancestor of the surface and so never propagates down to it.
  await page.evaluate((point) => {
    const surface = document.querySelector("[data-testid=canvas-surface]")!;
    const send = (target: EventTarget, type: string) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: point.x,
          clientY: point.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    send(surface, "pointerdown");
    send(document.body, "pointerup");
  }, centre);

  // And the harder version of the same thing: a release that is never
  // delivered at all, to anyone. The next primary touch is the recovery,
  // because the platform only calls a touch primary when nothing else is down.
  await page.evaluate((point) => {
    document.querySelector("[data-testid=canvas-surface]")!.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 9,
        pointerType: "touch",
        isPrimary: false,
        button: 0,
        buttons: 1,
        clientX: point.x + 40,
        clientY: point.y + 40,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, centre);

  // One finger now, and one finger pans. If the lifted one is still counted the
  // board reads two and pinches instead, which zooms on every drag and leaves
  // the user no way to put it back — the finger that would clear it is already
  // gone.
  const before = await gridOffset(page);
  await fingerDrag(page, centre, 90, 60);
  expect(
    await gridOffset(page),
    "one finger did not pan, so the lifted one is still being counted",
  ).not.toBe(before);
  await expect(page.getByTestId("zoom-reset")).toHaveText("100%");
});

/**
 * A long press, as the primitive sees it: a single touch that stays put.
 *
 * Touch events rather than pointer events because that is what Base UI's
 * context menu listens to — it starts its timer on `touchstart` and cancels it
 * if the finger travels more than ten pixels.
 */
async function longPress(page: Page, at: { x: number; y: number }) {
  await page.evaluate((point) => {
    const target = document.elementFromPoint(point.x, point.y)!;
    const touch = new Touch({
      identifier: 1,
      target,
      clientX: point.x,
      clientY: point.y,
    });
    target.dispatchEvent(
      new TouchEvent("touchstart", {
        touches: [touch],
        targetTouches: [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    );
  }, at);
  // The primitive's own delay is 500ms, and nothing here can observe the timer.
  await page.waitForTimeout(700);
}

test("a long press on the words being read is not a request for a menu", async ({
  page,
}) => {
  await pasteTextImage(page, ["Titanium white", "Cadmium red"]);
  const node = page.getByTestId("board-node");
  await expect(node).toHaveAttribute("data-ocr-status", "done");
  const box = (await node.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // A long press is a menu until the node is being read.
  await longPress(page, centre);
  await expect(page.getByTestId("node-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("node-menu")).toHaveCount(0);

  await page.touchscreen.tap(centre.x, centre.y);
  await page.touchscreen.tap(centre.x, centre.y);
  const overlay = page.locator("[data-testid=ocr-overlay][data-active]");
  await expect(overlay).toHaveCount(1);

  // Now it is how the selection is extended, and there is no other way to
  // extend one on a phone. A menu here takes the selection away at the moment
  // it is being made.
  const word = (await overlay.locator("[data-word]").first().boundingBox())!;
  const centreOfWord = {
    x: word.x + word.width / 2,
    y: word.y + word.height / 2,
  };
  await longPress(page, centreOfWord);
  await expect(page.getByTestId("node-menu")).toHaveCount(0);

  // The other half of the same gesture. iOS reaches the menu through the
  // primitive's own long-press timer, which starts on `touchstart`; Android
  // holds the finger and the system fires a native `contextmenu`, so the first
  // fix caught one phone and missed the other (D95).
  await page.evaluate((point) => {
    document.elementFromPoint(point.x, point.y)!.dispatchEvent(
      new PointerEvent("contextmenu", {
        clientX: point.x,
        clientY: point.y,
        pointerType: "touch",
        bubbles: true,
        cancelable: true,
      }),
    );
  }, centreOfWord);
  await expect(page.getByTestId("node-menu")).toHaveCount(0);
});
