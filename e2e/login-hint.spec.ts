import { expect, test } from "@playwright/test";

/**
 * The account chooser, and not showing it twice (D82).
 *
 * Google's token flow is the one part of this app that cannot be exercised for
 * real, so the script is replaced with a stub that records the arguments it was
 * called with. That is enough: the whole fix is one argument, and the failure
 * it prevents — a chooser appearing on every reconnect for anyone signed into
 * two accounts — is invisible to anyone testing with one.
 */

/** Stands in for `accounts.google.com/gsi/client`, and remembers what it was asked. */
async function stubGoogle(page: import("@playwright/test").Page) {
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { __tokenCalls: unknown[] }).__tokenCalls = calls;
    // Typed as `unknown`: this is a stand-in for someone else's global, and
    // describing it properly here would only duplicate `gis.ts`.
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            callback: (response: unknown) => void;
          }) => ({
            requestAccessToken: (overrides?: unknown) => {
              calls.push(overrides);
              config.callback({
                access_token: "stub-token",
                expires_in: 3600,
              });
            },
          }),
          revoke: (_token: string, done?: () => void) => done?.(),
        },
      },
    };
  });
}

/** What `lastAccount()` reads. Seeding it is what makes this a returning browser. */
async function rememberAccount(
  page: import("@playwright/test").Page,
  email: string,
) {
  await page.addInitScript((address) => {
    localStorage.setItem(
      "canwas.drive.account",
      JSON.stringify({ email: address }),
    );
  }, email);
}

async function tokenCalls(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => (window as unknown as { __tokenCalls: unknown[] }).__tokenCalls,
  );
}

test("a browser that has connected before names the account it wants", async ({
  page,
}) => {
  await stubGoogle(page);
  await rememberAccount(page, "someone@example.com");

  await page.goto("?engine=mock&sync=fake#/hintboard");
  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-sign-in").click();

  await expect
    .poll(() => tokenCalls(page))
    .toEqual([{ prompt: "", hint: "someone@example.com" }]);
});

test("a first connection names nobody", async ({ page }) => {
  await stubGoogle(page);

  await page.goto("?engine=mock&sync=fake#/hintboard");
  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-sign-in").click();

  // Consent, and no hint: this is someone choosing an account, and steering
  // them at a remembered one is the opposite of what they asked for.
  await expect.poll(() => tokenCalls(page)).toEqual([{ prompt: "consent" }]);
});
