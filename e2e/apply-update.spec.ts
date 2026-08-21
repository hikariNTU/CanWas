import { expect, test, type Page } from "@playwright/test";

/**
 * The reload button, driven against a stubbed `ServiceWorkerContainer`.
 *
 * No real service worker is available here — the dev server registers none —
 * and the failure being fixed is not reproducible in a desktop browser anyway:
 * it needs Chrome on Android to lose a waiting worker while the prompt is
 * still on screen (D94). What is testable is the promise the button makes,
 * which is that pressing it always does something.
 */
interface Scenario {
  waiting: boolean;
  waitingAfterUpdate?: boolean;
  controllerChanges?: boolean;
  updateThrows?: boolean;
}

async function run(page: Page, scenario: Scenario): Promise<string[]> {
  await page.goto("?engine=mock#/update");
  return page.evaluate(async (options: Scenario) => {
    const { applyUpdate } = (await import(
      /* @vite-ignore */ new URL("src/pwa/apply-update.ts", document.baseURI)
        .href
    )) as typeof import("../src/pwa/apply-update");

    const log: string[] = [];
    let controllerChange: (() => void) | null = null;
    const worker = {
      postMessage: (message: { type: string }) => log.push(message.type),
    };
    const registration = {
      waiting: options.waiting ? worker : null,
      update: () => {
        log.push("update");
        if (options.waitingAfterUpdate) {
          registration.waiting = worker;
        }
        return Promise.resolve();
      },
    };
    const container = {
      addEventListener: (type: string, handler: () => void) => {
        if (type === "controllerchange") {
          controllerChange = handler;
        }
      },
      getRegistration: () => Promise.resolve(registration),
    } as unknown as ServiceWorkerContainer;

    await applyUpdate({
      updateServiceWorker: () => {
        log.push("library");
        return options.updateThrows
          ? Promise.reject(new Error("no waiting worker"))
          : Promise.resolve();
      },
      container,
      reload: () => log.push("reload"),
      timeoutMs: 50,
    });

    if (options.controllerChanges) {
      (controllerChange as (() => void) | null)?.();
    }
    // Longer than the timeout, so a reload that was never going to happen has
    // had every chance to.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return log;
  }, scenario);
}

test("the library's own path is tried first", async ({ page }) => {
  const log = await run(page, { waiting: true });
  expect(log[0]).toBe("library");
});

test("a waiting worker is asked directly, not through a stale handle", async ({
  page,
}) => {
  // The bug: workbox reads `waiting` off the registration it captured when the
  // page registered, and posts nothing at all when that has become null. This
  // one is fetched at click time instead.
  const log = await run(page, { waiting: true });
  expect(log).toContain("SKIP_WAITING");
});

test("a worker that only appears after update() is still asked", async ({
  page,
}) => {
  const log = await run(page, { waiting: false, waitingAfterUpdate: true });
  expect(log).toContain("SKIP_WAITING");
});

test("the button reloads even when nothing is waiting", async ({ page }) => {
  // The Android case: the prompt is on screen, the worker behind it is gone,
  // and every polite path is a no-op. A reload is still owed — and if the new
  // worker activated in the background, a reload is all that was needed.
  const log = await run(page, { waiting: false, updateThrows: true });
  expect(log).toContain("reload");
});

test("the new worker taking over reloads once, not twice", async ({ page }) => {
  const log = await run(page, { waiting: true, controllerChanges: true });
  expect(log.filter((entry) => entry === "reload")).toHaveLength(1);
});
