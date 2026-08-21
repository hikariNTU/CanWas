import { expect, test, type Page } from "@playwright/test";

import { PNG, storedAssets } from "./support";

/**
 * What a phone sees at `http://192.168.x.x`: no `crypto.subtle`, because it is
 * a secure-context API and a LAN address is not a secure context (D92).
 *
 * Deleted rather than emulated, since Playwright has no insecure-origin mode
 * and the deployed site is HTTPS. `crypto` itself stays — `getRandomValues` is
 * not gated, which is exactly why text nodes went on working while images did
 * not.
 */
async function withoutWebCrypto(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      value: undefined,
    });
  });
}

const file = { name: "photo.png", mimeType: "image/png", buffer: PNG };

test("the software digest is the one WebCrypto would have produced", async ({
  page,
}) => {
  await page.goto("?engine=mock#/hash");

  // Lengths chosen for the padding rule: a block is 64 bytes and the length
  // occupies the last 8, so 55/56 and 119/120 are where a message stops
  // fitting and gains a whole extra block.
  const lengths = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 1000, 100_000];
  const mismatches = await page.evaluate(async (sizes) => {
    const { sha256Hex } = (await import(
      /* @vite-ignore */ new URL("src/lib/sha256.ts", document.baseURI).href
    )) as { sha256Hex: (bytes: Uint8Array) => string };
    const bad: { length: number; want: string; got: string }[] = [];
    for (const length of sizes) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        bytes[i] = (i * 31 + 7) % 256;
      }
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const want = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const got = sha256Hex(bytes);
      if (want !== got) {
        bad.push({ length, want, got });
      }
    }
    return bad;
  }, lengths);

  expect(mismatches).toEqual([]);
});

test("an image still lands when the origin has no WebCrypto", async ({
  page,
}) => {
  await withoutWebCrypto(page);
  await page.goto("?engine=mock#/nocrypto");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  // Confirms the premise: without this the test would pass on a browser that
  // still has the API and prove nothing.
  expect(await page.evaluate(() => crypto.subtle === undefined)).toBe(true);

  await page.getByTestId("add-image-input").setInputFiles(file);

  const node = page.getByTestId("board-node");
  await expect(node).toHaveCount(1);
  await expect(node).toHaveAttribute("data-node-kind", "image");
  // No warning: the fallback is a working path, not a degraded one.
  await expect(page.getByTestId("ingest-error")).toHaveCount(0);
});

test("the same bytes are one asset, hashed either way", async ({ page }) => {
  await page.goto("?engine=mock#/bothways");
  await page.getByTestId("add-image-input").setInputFiles(file);
  await expect(page.getByTestId("board-node")).toHaveCount(1);
  const before = (await storedAssets(page)).map((asset) => asset.id);
  expect(before).toHaveLength(1);

  // The digest is the asset's id, so the two implementations disagreeing would
  // fork every id a phone creates — the same picture on two devices would be
  // two assets, uploaded twice and recognized twice. One stored asset after
  // ingesting the same file through the other path is what rules that out.
  await withoutWebCrypto(page);
  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.getByTestId("add-image-input").setInputFiles(file);
  // Node count is not the measure here: board layout is written back on a
  // debounce, so a reload this fast starts from an empty board. The asset
  // store is the durable half, and it is the half the digest keys.
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  const after = (await storedAssets(page)).map((asset) => asset.id);
  expect(after).toEqual(before);
  expect(after, "the two implementations produced different ids").toHaveLength(
    1,
  );
});

test("a failed ingest says so instead of doing nothing", async ({ page }) => {
  await page.addInitScript(() => {
    Blob.prototype.arrayBuffer = () => Promise.reject(new Error("no bytes"));
  });
  await page.goto("?engine=mock#/broken");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  await page.getByTestId("add-image-input").setInputFiles(file);

  // The point of the change: every call site is a `void ingestFiles(...)`, so
  // a rejection used to reach `unhandledrejection` and the button looked dead.
  const warning = page.getByTestId("ingest-error");
  await expect(warning).toBeVisible();
  await expect(page.getByTestId("board-node")).toHaveCount(0);

  // Dismissable, and by the pill itself: there is nowhere else to put a close
  // button on something this size.
  await warning.click();
  await expect(warning).toHaveCount(0);
});
