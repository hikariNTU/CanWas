import { expect, test, type Page } from "@playwright/test";

/**
 * What a browser remembers about the account between sessions.
 *
 * Nothing here is a credential. The token is memory-only and Google's token
 * model has no silent path, so every reload ends in a click — what is stored
 * only decides whether that click is labelled "Connect" or wears the face of
 * the account it would reconnect as.
 */

const KEY = "canwas.drive.account";

async function remember(page: Page, value: unknown) {
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: KEY,
    raw: typeof value === "string" ? value : JSON.stringify(value),
  });
  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("?engine=mock&sync=fake#/account");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("a browser that has never connected is not offered a reconnect", async ({
  page,
}) => {
  await expect(page.getByTestId("sync-reconnect")).toHaveCount(0);
  // And the panel asks to connect, not to reconnect.
  await page.getByTestId("sync-button").click();
  await expect(page.getByTestId("sync-sign-in")).toHaveText(
    "Connect Google Drive",
  );
});

test("a remembered account puts a reconnect beside the icon", async ({
  page,
}) => {
  await remember(page, {
    email: "someone@example.com",
    name: "Some One",
    photo: "https://example.invalid/never-loads.png",
  });

  // Beside the icon, not behind it: reconnecting is not a decision, and after
  // a reload it is the most likely thing to happen next.
  const pill = page.getByTestId("sync-reconnect");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("Reconnect");

  // The photo cannot load. A broken image where a face should be reads as a
  // broken connection, so the fallback is the initial.
  await expect(pill.getByTestId("sync-avatar")).toHaveText("S");

  await page.getByTestId("sync-button").click();
  await expect(page.getByTestId("sync-account")).toHaveText("Some One");
  await expect(page.getByTestId("sync-panel")).toContainText(
    "someone@example.com",
  );
});

test("an account with no name falls back to the address", async ({ page }) => {
  await remember(page, { email: "nameless@example.com" });
  await page.getByTestId("sync-button").click();
  await expect(page.getByTestId("sync-account")).toHaveText(
    "nameless@example.com",
  );
  // Not printed twice under itself. The panel is 18rem wide.
  await expect(
    page.getByTestId("sync-panel").getByText("nameless@example.com"),
  ).toHaveCount(1);
});

test("a corrupt remembered account is ignored, not crashed on", async ({
  page,
}) => {
  // Another version of this app, a hand-edited value, a half-written write.
  await remember(page, "not json at all");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await expect(page.getByTestId("sync-reconnect")).toHaveCount(0);

  await remember(page, { email: 42, photo: { nope: true } });
  await expect(page.getByTestId("sync-button")).toBeVisible();
  // The record parses but says nothing usable. It still counts as "connected
  // before", and the avatar has a letter to fall back to.
  await expect(page.getByTestId("sync-reconnect")).toBeVisible();
  await expect(
    page.getByTestId("sync-reconnect").getByTestId("sync-avatar"),
  ).toHaveText("?");
});

test("a live sync is green", async ({ page }) => {
  // The one state worth colouring: work is somewhere other than this machine,
  // and it is read at the edge of vision rather than looked at.
  const button = page.getByTestId("sync-button");
  await expect(button).toHaveAttribute("data-sync-state", "idle");
  await expect(button).toHaveClass(/emerald/);
});
