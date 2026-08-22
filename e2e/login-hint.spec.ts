import { expect, test } from "@playwright/test";

/**
 * What the token flow is asked for, and what survives it (D82, D108).
 *
 * Google's token flow is the one part of this app that cannot be exercised for
 * real, so the script is replaced with a stub that records the arguments it was
 * called with and can be told to fail. That is enough for both questions here:
 * which prompt and hint go out, and what the app forgets when the answer comes
 * back. Both failures they prevent — a chooser on every reconnect, a consent
 * screen on every device — are invisible to anyone testing with one account on
 * one machine.
 */

/** How the stub answers: with a token, or with one of Google's failures. */
interface StubOptions {
  /** Reported through `callback`, the way Google reports a refused grant. */
  error?: string;
  /** Reported through `error_callback`, the way Google reports a closed popup. */
  errorType?: string;
}

/** Stands in for `accounts.google.com/gsi/client`, and remembers what it was asked. */
async function stubGoogle(
  page: import("@playwright/test").Page,
  options: StubOptions = {},
) {
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
  await page.addInitScript((stub: StubOptions) => {
    const calls: unknown[] = [];
    const revoked: string[] = [];
    (window as unknown as { __tokenCalls: unknown[] }).__tokenCalls = calls;
    (window as unknown as { __revoked: string[] }).__revoked = revoked;
    // Typed as `unknown`: this is a stand-in for someone else's global, and
    // describing it properly here would only duplicate `gis.ts`.
    (window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            callback: (response: unknown) => void;
            error_callback?: (error: unknown) => void;
          }) => ({
            requestAccessToken: (overrides?: unknown) => {
              calls.push(overrides);
              if (stub.errorType) {
                config.error_callback?.({ type: stub.errorType });
                return;
              }
              if (stub.error) {
                config.callback({ error: stub.error });
                return;
              }
              config.callback({
                access_token: "stub-token",
                expires_in: 3600,
              });
            },
          }),
          // Recorded rather than removed. Nothing should call this: revoking is
          // account-wide, and signing out is not (D108). A test that watches an
          // unused function is the only way that stays true.
          revoke: (token: string, done?: () => void) => {
            revoked.push(token);
            done?.();
          },
        },
      },
    };
  }, options);
}

/** Whichever account this browser remembers, as the app stores it. */
async function storedAccount(page: import("@playwright/test").Page) {
  return page.evaluate(() => localStorage.getItem("canwas.drive.account"));
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

test("a first connection names nobody, and does not demand consent", async ({
  page,
}) => {
  await stubGoogle(page);

  await page.goto("?engine=mock&sync=fake#/hintboard");
  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-sign-in").click();

  // No hint: this is someone choosing an account, and steering them at a
  // remembered one is the opposite of what they asked for.
  //
  // And no `prompt: "consent"` either. The default prompt already shows the
  // consent screen when the account has not granted, and demands a second one
  // when it has — which is what a second device is (D108).
  await expect.poll(() => tokenCalls(page)).toEqual([{ prompt: "" }]);
});

test("signing out forgets this browser and leaves the grant alone", async ({
  page,
}) => {
  await stubGoogle(page);
  await rememberAccount(page, "someone@example.com");

  await page.goto("?engine=mock&sync=fake#/hintboard");
  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-sign-in").click();
  await expect(page.getByTestId("sync-signed-in")).toBeVisible();
  await page.getByTestId("sync-sign-out").click();

  // Forgotten here…
  await expect.poll(() => storedAccount(page)).toBeNull();
  // …and untouched there. Revoking would end the grant for the account, so
  // every other device would pay a consent screen and a security email for a
  // sign-out that happened on this one.
  expect(
    await page.evaluate(
      () => (window as unknown as { __revoked: string[] }).__revoked,
    ),
  ).toEqual([]);
});

test("a dismissed popup does not forget the account", async ({ page }) => {
  await stubGoogle(page, { errorType: "popup_closed" });
  await rememberAccount(page, "someone@example.com");

  await page.goto("?engine=mock&sync=fake#/hintboard");
  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-sign-in").click();
  await expect(page.getByTestId("sync-error")).toBeVisible();

  // Closing a popup says nothing about whether Google still holds a grant.
  // Forgetting here would cost the next attempt the very consent screen the
  // remembered account exists to skip.
  await expect.poll(() => storedAccount(page)).toContain("someone@example.com");
});

test("a refused grant is forgotten", async ({ page }) => {
  await stubGoogle(page, { error: "access_denied" });
  await rememberAccount(page, "someone@example.com");

  await page.goto("?engine=mock&sync=fake#/hintboard");
  await page.getByTestId("sync-button").click();
  await page.getByTestId("sync-sign-in").click();
  await expect(page.getByTestId("sync-error")).toBeVisible();

  // The other half of the same rule: this one really does mean the grant is
  // not what this browser remembered, so the memory goes.
  await expect.poll(() => storedAccount(page)).toBeNull();
});
