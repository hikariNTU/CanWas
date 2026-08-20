import { expect, test } from "@playwright/test";

import { pasteTextImage } from "./support";

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock#/aboutboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("the info panel reports the build and what is on disk", async ({
  page,
}) => {
  await page.getByTestId("about-open").click();
  const panel = page.getByTestId("about-panel");
  await expect(panel).toBeVisible();

  // The build identity is inlined at build time, so it is never "unknown" in a
  // checkout with git available.
  await expect(panel).toContainText("PP-OCRv5 mobile");
  await expect(panel).toContainText("onnxruntime-web");
  await expect(panel).not.toContainText("unknown");

  // Nothing pasted yet: no images, and the mock engine downloads no weights.
  await expect(panel).toContainText("not downloaded yet");
  await expect(page.getByTestId("about-clear-models")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  await pasteTextImage(page, ["something to store"]);
  await expect(page.getByTestId("board-node")).toHaveCount(1);

  await page.getByTestId("about-open").click();
  // The image is counted from the stored blob, so it has to have been written
  // before it shows up here — which is the point of showing it.
  await expect
    .poll(
      async () => (await page.getByTestId("about-images").textContent()) ?? "",
    )
    .not.toContain("0 B");
  // Still no weights: the mock downloads nothing.
  await expect(page.getByTestId("about-model-bytes")).toContainText("0 B");

  await page.screenshot({ path: "e2e/screenshots/about.png" });
});

test("the sync panel offers exactly one of sign-in or an explanation", async ({
  page,
}) => {
  await page.getByTestId("sync-button").click();

  // Which branch shows depends on whether this build was given a client id,
  // which depends on whether a developer has a .env — so the test asserts the
  // property that must hold either way rather than one of the two outcomes.
  // A sign-in button that cannot work is worse than none, and a silently
  // missing one is a mystery to whoever has to debug it later.
  const explained = page.getByTestId("sync-unconfigured");
  const signIn = page.getByTestId("sync-sign-in");
  await expect(explained.or(signIn).first()).toBeVisible();
  expect(await explained.count()).toBe(1 - (await signIn.count()));

  // Nothing third-party is fetched until sign-in is actually pressed: the
  // script is loaded on demand rather than from index.html, so a session that
  // never touches sync never touches Google.
  const google = page.locator('script[src*="accounts.google.com"]');
  await expect(google).toHaveCount(0);
});
