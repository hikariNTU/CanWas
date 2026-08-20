import { expect, test, type Page } from "@playwright/test";

/**
 * Cached weights have no owner.
 *
 * Model ids carry their version so a device holding an older graph never reads
 * it out of the cache by mistake — but the retired rows were never deleted,
 * and no code path names a retired id again, so nothing would ever have
 * collected them. The move from PP-OCRv5 to v6 left 21 MB of dead bytes behind
 * the 31 MB of live ones and the About panel honestly reported 50 MB.
 *
 * The sweep runs at startup, against the ids the build still knows.
 */

const DB = "canwas";

function writeModel(page: Page, id: string, bytes: number) {
  return page.evaluate(
    ([name, modelId, size]) =>
      new Promise<void>((resolve, reject) => {
        // No version: opening at the current one, whatever it is. A version
        // number here would have to be kept in step with the app's.
        const request = indexedDB.open(name as string);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("models", "readwrite");
          transaction.objectStore("models").put({
            id: modelId,
            bytes: new ArrayBuffer(size as number),
            etag: "",
            fetchedAt: Date.now(),
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    [DB, id, bytes] as const,
  );
}

function storedModelIds(page: Page) {
  return page.evaluate(
    (name) =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const keys = db
            .transaction("models", "readonly")
            .objectStore("models")
            .getAllKeys();
          keys.onsuccess = () => {
            db.close();
            resolve(keys.result as string[]);
          };
          keys.onerror = () => reject(keys.error);
        };
      }),
    DB,
  );
}

test("a retired model is swept and the current one is kept", async ({
  page,
}) => {
  await page.goto("?engine=mock#/weightsboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  // The id the app no longer names anywhere, and one it does. Which id is
  // current is read from the panel rather than written down here, so this does
  // not have to be edited on the next model change — the sweep's contract is
  // "keep what the build knows", not "keep this string".
  await page.getByTestId("about-open").click();
  const panel = page.getByTestId("about-panel");
  await expect(panel).toBeVisible();
  const ids = ((await panel.textContent()) ?? "").match(/ppocrv[\w-]+/g) ?? [];
  expect(ids.length).toBeGreaterThan(0);
  const current = ids[0]!;
  await page.keyboard.press("Escape");

  await writeModel(page, "ppocrv5-mobile-rec", 4096);
  await writeModel(page, current, 2048);
  expect(await storedModelIds(page)).toContain("ppocrv5-mobile-rec");

  await page.reload();
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  await expect
    .poll(async () => await storedModelIds(page))
    .not.toContain("ppocrv5-mobile-rec");
  // And not simply everything: a sweep that cleared the store would pass the
  // line above while costing every user a 31 MB re-download.
  expect(await storedModelIds(page)).toContain(current);
});
