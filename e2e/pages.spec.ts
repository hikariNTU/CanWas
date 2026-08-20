import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * The static document pages (D67).
 *
 * These are the pages someone reads when the app failed, and the pages a
 * reviewer at Google reads before granting anything. Both audiences make the
 * same two demands the app itself does not: that the page renders without the
 * application, and that what it says is still true.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file: string) => readFileSync(root + file, "utf8");

const PAGES = [
  // First because it is the one Google's reviewer is sent to: the OAuth
  // consent screen's "application home page" points here rather than at the
  // app, which redirects into a board and explains nothing to someone who has
  // not signed in (D80).
  { file: "about.html", title: "About" },
  { file: "privacy.html", title: "Privacy" },
  { file: "support.html", title: "Support" },
  { file: "licenses.html", title: "Licenses" },
];

for (const { file, title } of PAGES) {
  test(`${file} renders on its own, with no script at all`, async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));

    await page.goto(file);
    await expect(page).toHaveTitle(new RegExp(`${title}.*CanWas`));
    await expect(page.locator("h1").first()).toBeVisible();

    // Zero JavaScript is the property that makes these useful. A stray import
    // would make the disclosure page depend on the thing it exists to explain.
    // The dev server injects its own client and the React refresh preamble
    // into every HTML entry, and neither is in the built page — so they are
    // named and excluded rather than asserting a count that only holds in
    // production.
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll("script")]
        .map(
          (element) => element.getAttribute("src") ?? element.textContent ?? "",
        )
        .filter((source) => !/@vite|react-refresh/.test(source)),
    );
    expect(scripts, "the page ships JavaScript of its own").toEqual([]);
    expect(failures).toEqual([]);

    // And nothing of ours in the file itself, which is what actually deploys.
    expect(read(file)).not.toContain("<script");

    // The stylesheet has to have actually applied: an unstyled page here means
    // the multi-page build stopped processing the `<link>`, which is silent.
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(10, 10, 10)",
    );

    // Both languages, in the same document rather than behind a toggle.
    await expect(page.locator("[lang='zh-Hant']")).toHaveCount(1);
  });
}

test("the pages reach each other and the app", async ({ page }) => {
  await page.goto("privacy.html");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Support" })
    .click();
  await expect(page).toHaveURL(/support\.html$/);

  await page.getByRole("link", { name: "Open CanWas" }).click();
  // The app is a hash router under a base path; the document pages sit beside
  // it, so "back to the app" has to land on a booted canvas rather than a 404.
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
});

test("the privacy policy names every third party the code contacts", async () => {
  const policy = read("privacy.html");

  // Scanned out of the source rather than listed here. A new host added to the
  // app is a new disclosure, and the only way that stays true is if the test
  // reads the same place the fetch does.
  const sources = [
    "src/ocr/paddle/models.ts",
    "src/sync/auth.ts",
    "src/sync/drive.ts",
    "index.html",
  ];
  const hosts = new Set<string>();
  for (const file of sources) {
    for (const match of read(file).matchAll(/https:\/\/([a-z0-9.-]+)/g)) {
      hosts.add(match[1]!);
    }
  }
  // Not a third party: it is the app's own permission vocabulary, checked
  // separately below.
  hosts.delete("developers.google.com");

  expect(hosts.size).toBeGreaterThan(0);
  for (const host of hosts) {
    expect(policy, `${host} is contacted but not disclosed`).toContain(host);
  }
});

test("the privacy policy names the scope the code actually requests", async () => {
  // Read out of the source text rather than imported: `auth.ts` reads
  // `import.meta.env` at module scope, which is undefined outside Vite.
  const scope = /DRIVE_SCOPE = "([^"]+)"/.exec(read("src/sync/auth.ts"));
  expect(scope, "auth.ts no longer declares DRIVE_SCOPE").not.toBeNull();

  // The narrowness of `drive.file` is the central promise the policy makes.
  // Widening the scope in code without editing the policy would turn that
  // paragraph into a false statement, which is the one failure here that has
  // consequences beyond the app.
  expect(read("privacy.html")).toContain(scope![1]!);
});

test("the licence list is generated and current", async () => {
  const licenses = read("licenses.html");
  expect(licenses).not.toContain("Run <code>npm run licenses</code>");

  // Everything shipped is named, including the two that no dependency list
  // would find: the runtime-loaded weights and the CDN fonts.
  expect(licenses).toContain("PP-OCRv6");
  expect(licenses).toContain("Material Symbols");

  // Every runtime dependency reaches the bundle, so every one must be listed.
  // This is the test that fails when someone adds a package and forgets to run
  // `npm run licenses`.
  const manifest = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
  };
  for (const name of Object.keys(manifest.dependencies)) {
    expect(licenses, `${name} ships but is not listed`).toContain(`>${name}<`);
  }
});

test("the about panel links out to every document page", async ({ page }) => {
  await page.goto("?engine=mock#/docsboard");
  await page.getByTestId("about-open").click();
  const panel = page.getByTestId("about-panel");

  for (const { file } of PAGES) {
    await expect(
      panel.locator(`a[href$="${file}"]`),
      `${file} is not linked from the about panel`,
    ).toHaveCount(1);
  }
});

/**
 * The three things Google rejected the last submission for, as assertions.
 *
 * A consent-screen review fails on the home page rather than on the code, and
 * it fails silently weeks later. These are cheap enough to keep.
 */
test("the home page states its purpose, its scope, and who publishes it", async ({
  page,
}) => {
  await page.goto("about.html");

  // Nothing is asked of the reader before they can read it. A page that waits
  // for a sign-in is the second thing the review objected to, and here that
  // would show up as an empty document rather than as an error.
  // Exact, because the zh-Hant half of the page carries its own heading.
  await expect(
    page.getByRole("heading", { name: "CanWas", exact: true }),
  ).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text.length).toBeGreaterThan(1500);
  expect(text).not.toMatch(/sign in to continue|please sign in/i);

  // What the app is for, in the reviewer's words: an app description, the
  // Google data it touches, and why it touches it.
  const scope = /DRIVE_SCOPE = "([^"]+)"/.exec(read("src/sync/auth.ts"))![1]!;
  expect(text).toContain(scope);
  expect(text).toMatch(/only those files it has itself created/i);

  // An identifiable publisher and a way to reach them.
  expect(text).toMatch(/Dennis Chung/);
  expect(
    page.locator("a[href*='github.com/hikariNTU/canwas/issues']"),
  ).toBeTruthy();

  // And the two links the consent screen submits alongside this one, both of
  // which must be reachable from it.
  for (const file of ["privacy.html", "support.html"]) {
    await expect(page.locator(`a[href$="${file}"]`).first()).toBeVisible();
  }
});
